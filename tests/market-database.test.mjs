import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { getMarketConfig, INTERVALS } from "../lib/market/config.mjs";
import { openMarketDatabase, withMarketDatabase } from "../lib/market/database.mjs";
import { readMarketSnapshot, readMarketCheckpoint, readCandlePage, readTransactionPage } from "../lib/market/repository.mjs";
import { appendMarketBatch } from "../lib/market/indexer-store.mjs";
import { backupMarketDatabase } from "../lib/market/data-maintenance.mjs";
import { ensureCandleVolumes } from "../lib/market/volume-maintenance.mjs";
import { indexMarketRange } from "../lib/market/indexer.mjs";
import { pairInterface } from "../lib/market/contracts.mjs";
import { ensureExactTimestamps, reconcileChain } from "../lib/market/chain-integrity.mjs";
import { evaluateMarketHealth, readMarketHealth, writeWorkerStatus } from "../lib/market/health.mjs";
import { getPairLogs } from "../lib/market/providers.mjs";

const wallet = "0x675d6c9ef24109a5524cf6f8a3c27771149c172a";
const hash = (number) => `0x${number.toString(16).padStart(64, "0")}`;
const event = (number, timestamp = 1_800_000_000, overrides = {}) => ({
  kind: "swap", side: number % 2 ? "Buy" : "Sell", tx: hash(number), logIndex: number, blockNumber: number,
  timestamp, time: new Date(timestamp * 1_000).toISOString(), price: 100 + number, baseAmount: 2, quoteAmount: 2 * (100 + number),
  wallet, transactionFrom: wallet, walletSource: "transaction.from", ...overrides,
});
const state = (blockNumber, price = 1800) => ({
  blockNumber, price, factory: wallet, displayBaseIndex: 0,
  displayBaseToken: { name: "HUGE", symbol: "HUGE", decimals: 18, address: wallet },
  displayQuoteToken: { name: "NFX", symbol: "NFX", decimals: 18, address: wallet },
  displayBaseReserve: 2, displayQuoteReserve: price * 2,
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chart-db-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = getMarketConfig({ MARKET_DATA_FILE: path.join(directory, "market.db"), MARKET_START_BLOCK: "1", MARKET_LOG_CHUNK_SIZE: "2" });
  return { directory, config };
}

test("首次直接写入 SQLite，六周期 K 线与断点完整保存，不依赖旧文件", async (t) => {
  const { config } = await fixture(t);
  const events = [event(1), event(2, 1_800_000_060, { kind: "addLiquidity", side: "AddLiquidity" }), event(3, 1_800_000_070, { kind: "sync" })];
  const result = await appendMarketBatch(state(5), events, config, 1_800_000_080, { fromBlock: 1 });
  assert.deepEqual(result, { lastBlock: 5, addedEvents: 3, totalEvents: 3 });
  const restored = await readMarketSnapshot(config, { full: true });
  assert.deepEqual(restored.history.events, events);
  assert.equal(restored.history.lastBlock, 5);
  assert.equal(restored.history.totalEvents, 2);
  assert.equal(restored.metadata.chainId, 1677);
  for (const interval of Object.keys(INTERVALS)) assert.equal(restored.candlesByInterval[interval].at(-1).close, 1800);
  assert.deepEqual((await fs.readdir(path.dirname(config.dataFile))).filter((name) => name.endsWith(".json")), []);
});

test("错误数据库路径不覆盖文件，事件冲突不会产生部分历史", async (t) => {
  const { config } = await fixture(t);
  await assert.rejects(appendMarketBatch(state(5), [event(1), event(2, 1_800_000_000, { blockNumber: 1, logIndex: 1 })], config, 1_800_000_080, { fromBlock: 1 }), /UNIQUE constraint/);
  assert.equal(await readMarketCheckpoint(config), null);
  assert.equal(withMarketDatabase(config, false, (db) => db.prepare("SELECT count(*) AS n FROM events").get().n), 0);
  const wrongPath = config.dataFile + ".txt";
  await fs.writeFile(wrongPath, "do-not-overwrite");
  await assert.rejects(appendMarketBatch(state(5), [], { ...config, dataFile: wrongPath }, 1_800_000_080), /必须指向/);
  assert.equal(await fs.readFile(wrongPath, "utf8"), "do-not-overwrite");
});

test("VOL 仅统计 Swap，旧库自动备份修复六周期且不改变 OHLC、原始事件或断点", async (t) => {
  const { config } = await fixture(t);
  const now = 1_800_000_000;
  await appendMarketBatch(state(4, 130), [
    event(1, now, { price: 100, quoteAmount: 200 }),
    event(2, now + 1, { kind: "addLiquidity", side: "AddLiquidity", price: 150, quoteAmount: 50000 }),
    event(3, now + 2, { kind: "removeLiquidity", side: "RemoveLiquidity", price: 90, quoteAmount: 90000 }),
    event(4, now + 3, { price: 120, quoteAmount: 240 }),
  ], config, now + 4, { fromBlock: 1 });
  const correct = await readMarketSnapshot(config, { full: true });
  for (const candles of Object.values(correct.candlesByInterval)) {
    assert.equal(candles[0].volume, 440);
    assert.equal(candles[0].trades, 2);
    assert.equal(candles[0].high, 150);
    assert.equal(candles[0].low, 90);
  }
  assert.deepEqual(await ensureCandleVolumes(config), { changed: false });
  withMarketDatabase(config, true, (db) => {
    db.exec("UPDATE candles SET payload = json_set(payload, '$.volume', 140440, '$.trades', 4)");
    db.exec("UPDATE market_state SET header = json_remove(header, '$.history.candleVolumeVersion', '$.history.volumeUnit')");
  });
  await assert.rejects(appendMarketBatch(state(5), [], config, now + 5, { fromBlock: 5 }), /历史成交量修复/);
  const result = await ensureCandleVolumes(config);
  assert.equal(result.changed, true);
  assert.equal(result.candles, 6);
  const backup = await readMarketSnapshot({ ...config, dataFile: result.backup }, { full: true });
  assert.equal(backup.candlesByInterval["1m"][0].volume, 140440);
  const repaired = await readMarketSnapshot(config, { full: true });
  assert.equal(repaired.history.revision, correct.history.revision + 1);
  assert.deepEqual({ ...repaired, history: { ...repaired.history, revision: correct.history.revision } }, correct);
  assert.equal((await readMarketCheckpoint(config)).lastBlock, 4);
  assert.deepEqual(await ensureCandleVolumes(config), { changed: false });
  await appendMarketBatch(state(5, 140), [event(5, now + 5, { quoteAmount: 100 })], config, now + 5, { fromBlock: 5 });
  const updated = await readMarketSnapshot(config, { full: true });
  assert.equal(updated.candlesByInterval["1m"][0].volume, 540);
  assert.equal(updated.candlesByInterval["1m"][0].trades, 3);
});

test("24h SQL 指标口径正确，流动性/Sync 不误计成交，累计交易不被窗口清除", async (t) => {
  const { config } = await fixture(t);
  const now = 1_800_000_000;
  const events = [
    event(1, now - 90_000, { price: 50, quoteAmount: 100 }),
    event(2, now - 1_000, { side: "Buy", price: 100, quoteAmount: 200 }),
    event(3, now - 10, { side: "Sell", price: 120, quoteAmount: 240 }),
    event(4, now - 5, { kind: "addLiquidity", side: "AddLiquidity", price: 500, quoteAmount: 1000 }),
    event(5, now, { kind: "sync" }),
  ];
  const current = state(5, 130);
  await appendMarketBatch(current, events, config, now, { fromBlock: 1 });
  const market = await readMarketSnapshot(config);
  assert.equal(market.quote.high24h, 120);
  assert.equal(market.quote.low24h, 100);
  assert.equal(market.metrics[1].detail, "2 笔交易");
  assert.equal(market.metrics[2].detail, "24h：1 买入 · 1 卖出");
  assert.equal(market.quote.change24h, 160);
  assert.equal(market.quote.volume24h, 440);
  assert.equal(market.history.totalEvents, 4);
  assert.equal(market.metrics[2].value, "3");
});

test("批次原子回滚，事件去重，当前柱实时更新，10 天后仍保留原历史与断点", async (t) => {
  const { config } = await fixture(t);
  const now = 1_800_000_000;
  await appendMarketBatch(state(2, 102), [event(1), event(2)], config, now, { fromBlock: 1 });
  const before = await readMarketSnapshot(config, { full: true });
  const checkpoint = await readMarketCheckpoint(config);
  await assert.rejects(appendMarketBatch(state(4), [event(3), event(4, now, { price: NaN })], config, now + 60, { fromBlock: 3 }), /价格或数量/);
  assert.deepEqual(await readMarketSnapshot(config, { full: true }), before);
  assert.deepEqual(await readMarketCheckpoint(config), checkpoint);
  const replay = await appendMarketBatch(state(2, 102), [event(1), event(2)], config, now);
  assert.equal(replay.addedEvents, 0);
  assert.equal(replay.totalEvents, 2);
  await appendMarketBatch(state(3, 110), [event(3, now + 60, { price: 105, quoteAmount: 210 })], config, now + 60, { fromBlock: 3 });
  const updated = await readMarketSnapshot(config, { full: true });
  assert.equal(updated.quote.priceQuote, 110);
  assert.equal(updated.candlesByInterval["5m"].at(-1).close, 110);
  assert.equal(updated.candlesByInterval["5m"].at(-1).volume, 2 * 101 + 2 * 102 + 210);
  await appendMarketBatch(state(4, 120), [], config, now + 10 * 86_400, { fromBlock: 4 });
  const later = await readMarketSnapshot(config, { full: true });
  assert.equal(later.history.events.length, 3);
  assert.equal(later.history.lastBlock, 4);
  assert.equal(later.quote.volume24h, 0);
  assert.equal(later.metrics[2].value, "3");
  assert.equal(later.pool.createdAt, before.pool.createdAt);
  for (const interval of Object.keys(INTERVALS)) {
    assert.ok(later.candlesByInterval[interval].some((candle) => candle.timestamp === before.candlesByInterval[interval][0].timestamp));
  }
  await appendMarketBatch(state(9, 125), [], config, now + 10 * 86_400 + 5, { advanceCheckpoint: false });
  assert.equal((await readMarketCheckpoint(config)).lastBlock, 4, "仅刷新储备不能跳过未扫描日志");
  await assert.rejects(appendMarketBatch(state(6), [], config, now + 10 * 86_400 + 10, { fromBlock: 6 }), /不连续/);
});

test("SQL 首页有界、交易游标无重复，新增记录不扰乱历史分页，K 线范围/精度正确", async (t) => {
  const { config } = await fixture(t);
  const events = Array.from({ length: 350 }, (_, index) => event(index + 1, 1_800_000_000 + index * 300));
  // 同一区块不同日志仍可稳定翻页，Sync 不计入交易总量。
  events[348].blockNumber = 350;
  events.push(event(351, events.at(-1).timestamp, { kind: "sync" }));
  await appendMarketBatch(state(351), events, config, events.at(-1).timestamp, { fromBlock: 1 });
  const summary = await readMarketSnapshot(config);
  assert.equal(summary.history.events.length, 25);
  assert.equal(summary.history.totalEvents, 350);
  assert.equal(summary.candlesByInterval["5m"].length, 120);
  assert.equal(summary.candles.at(-1).close, 1800);
  const first = await readTransactionPage(config, null, 1);
  assert.equal(first.items[0].logIndex, 350);
  const cursor = JSON.parse(Buffer.from(first.page.nextCursor, "base64url").toString());
  await appendMarketBatch(state(352), [event(352, events.at(-1).timestamp + 1)], config, events.at(-1).timestamp + 1, { fromBlock: 352 });
  const next = await readTransactionPage(config, cursor, 200);
  assert.equal(next.items[0].logIndex, 349);
  assert.equal(next.page.total, 351);
  assert.ok(next.items.every((event) => event.logIndex < 350));
  const page = await readCandlePage(config, "5m", { from: 1_800_000_000, to: 1_800_000_000 + 9 * 300, before: 1_800_000_000 + 9 * 300, limit: 3 });
  assert.equal(page.page.total, 9);
  assert.equal(page.page.hasMore, true);
  assert.deepEqual(page.items.map((candle) => candle.timestamp), [6, 7, 8].map((index) => 1_800_000_000 + index * 300));
  const empty = await readCandlePage(config, "5m", { before: 1_800_000_000, limit: 3 });
  assert.equal(empty.items.length, 0);
  assert.equal(empty.page.nextCursor, null);
  const plan = withMarketDatabase(config, false, (db) => db.prepare("EXPLAIN QUERY PLAN SELECT payload FROM candles WHERE interval = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT 3").all("5m", 1_800_000_001));
  assert.match(JSON.stringify(plan), /SEARCH candles USING INDEX/);
});

test("在线备份包括 WAL，源库继续写入不改变备份，目标已有文件时拒绝覆盖", async (t) => {
  const { config, directory } = await fixture(t);
  await appendMarketBatch(state(1), [event(1)], config, 1_800_000_000, { fromBlock: 1 });
  const held = openMarketDatabase(config, { write: true });
  t.after(() => held.close());
  await appendMarketBatch(state(2), [event(2)], config, 1_800_000_060, { fromBlock: 2 });
  assert.ok((await fs.stat(`${config.dataFile}-wal`)).size > 0);
  const target = path.join(directory, "snapshot.db");
  await backupMarketDatabase(config, target);
  const backupConfig = { ...config, dataFile: target };
  assert.equal((await readMarketCheckpoint(backupConfig)).lastBlock, 2);
  await appendMarketBatch(state(3), [event(3)], config, 1_800_000_120, { fromBlock: 3 });
  assert.equal((await readMarketCheckpoint(backupConfig)).lastBlock, 2);
  assert.equal((await readMarketCheckpoint(config)).lastBlock, 3);
  await assert.rejects(backupMarketDatabase(config, target), { code: "EEXIST" });
  await assert.rejects(backupMarketDatabase(config, config.dataFile), /不能等于/);
});

test("逐批追块：第二批节点失败保留第一批断点，重启从下一块继续；零事件也保存断点", async (t) => {
  const { config } = await fixture(t);
  const provider = { getBlock: async (number) => ({ number, hash: hash(number), timestamp: 1_800_000_000 + number * 2 }), getBlockNumber: async () => 6 };
  const encoded = pairInterface.encodeEventLog(pairInterface.getEvent("Sync"), [100n, 100n]);
  const ranges = [];
  let failing = true;
  const loadLogs = async (_provider, _config, from, to) => {
    ranges.push([from, to]);
    if (failing && from === 3) throw new Error("节点离线");
    return [{ ...encoded, transactionHash: hash(to), blockNumber: to, blockHash: hash(to), index: 0 }];
  };
  const loadState = async (_provider, _config, blockNumber) => state(blockNumber);
  await assert.rejects(indexMarketRange(provider, config, { loadLogs, loadState }), /节点离线/);
  assert.equal((await readMarketCheckpoint(config)).lastBlock, 2);
  assert.deepEqual(ranges, [[1, 2], [3, 4]]);
  failing = false;
  ranges.length = 0;
  await indexMarketRange(provider, config, { loadLogs, loadState });
  assert.deepEqual(ranges, [[3, 4], [5, 6]]);
  assert.equal((await readMarketCheckpoint(config)).lastBlock, 6);
  assert.equal((await readMarketSnapshot(config, { full: true })).history.events.length, 3);
  await indexMarketRange(provider, config, { latestBlock: 8, loadLogs: async () => [], loadState });
  assert.equal((await readMarketCheckpoint(config)).lastBlock, 8);
  const noWork = await indexMarketRange(provider, config, { latestBlock: 8, loadLogs: () => { throw new Error("不应重扫"); }, loadState });
  assert.equal(noWork.addedEvents, 0);
  assert.equal(noWork.fromBlock, 9);
});

test("缺库返回未就绪而不创建文件，错误 LP、损坏文件不回退成首次扫描", async (t) => {
  const { config } = await fixture(t);
  assert.equal(await readMarketSnapshot(config), null);
  assert.equal(await readCandlePage(config, "1m", { limit: 1 }), null);
  await assert.rejects(fs.access(config.dataFile));
  await appendMarketBatch(state(1), [], config, 1_800_000_000, { fromBlock: 1 });
  await assert.rejects(readMarketSnapshot({ ...config, chainId: 1 }), /chainId\/LP/);
  const badConfig = { ...config, dataFile: config.dataFile + ".broken.db" };
  await fs.writeFile(badConfig.dataFile, "not-a-database");
  await assert.rejects(readMarketSnapshot(badConfig), /not a database/);
});

test("非归档 RPC 只读取最新合约状态，历史 Sync 按代币顺序还原储备，重启后空批延续", async (t) => {
  const { config } = await fixture(t);
  const provider = { getBlock: async (number) => ({ number, hash: hash(number), timestamp: 1_800_000_000 + number * 2 }), getBlockNumber: async () => 6 };
  const unit = 10n ** 18n;
  const encoded = pairInterface.encodeEventLog(pairInterface.getEvent("Sync"), [600n * unit, 2n * unit]);
  const loadState = async (_provider, _config, block) => {
    assert.equal(block, 6, "不应对旧区块发 eth_call");
    return { ...state(6, 400), displayBaseIndex: 1, displayBaseReserve: 2, displayQuoteReserve: 800 };
  };
  const loadLogs = async (_provider, _config, from) => from === 1
    ? [{ ...encoded, transactionHash: hash(1), blockNumber: 2, blockHash: hash(2), index: 0 }] : [];
  const observed = [];
  await indexMarketRange(provider, config, { latestBlock: 6, loadState, loadLogs,
    shouldStop: () => observed.length === 1,
    onBatch: (result) => observed.push(result),
  });
  let snapshot = await readMarketSnapshot(config);
  assert.equal(snapshot.history.lastBlock, 2);
  assert.equal(snapshot.pool.reserves.base, 2);
  assert.equal(snapshot.pool.reserves.quote, 600);
  assert.equal(snapshot.quote.priceQuote, 300);
  const blocks = [];
  await indexMarketRange(provider, config, { latestBlock: 6, loadState, loadLogs,
    onBatch: (result) => blocks.push(result.lastBlock),
  });
  snapshot = await readMarketSnapshot(config, { full: true });
  assert.deepEqual(blocks, [4, 6]);
  assert.equal(snapshot.quote.priceQuote, 400);
  assert.equal(snapshot.history.events.length, 1);
  assert.ok(snapshot.candlesByInterval["1m"].some((candle) => candle.open === 300));
});

test("事件读取真实区块时间，同一块多日志复用时间；错误哈希/缺失时间不推进断点", async (t) => {
  const { config } = await fixture(t);
  const calls = [];
  const provider = { getBlock: async (number) => { calls.push(number); return { number, hash: hash(number), timestamp: 1_800_000_000 + number * number * 90 }; } };
  const encoded = pairInterface.encodeEventLog(pairInterface.getEvent("Sync"), [100n, 100n]);
  const log = (number, index = 0) => ({ ...encoded, transactionHash: hash(number + index), blockNumber: number, blockHash: hash(number), index });
  await indexMarketRange(provider, config, { latestBlock: 2, loadState: async () => state(2), loadLogs: async () => [log(1), log(1, 1)] });
  const snapshot = await readMarketSnapshot(config, { full: true });
  assert.deepEqual(snapshot.history.events.map((item) => item.timestamp), [1_800_000_090, 1_800_000_090]);
  assert.equal(calls.filter((number) => number === 1).length, 1);
  assert.equal(snapshot.history.blockHash, hash(2));
  assert.equal(snapshot.history.timestampVersion, 1);
  await assert.rejects(indexMarketRange(provider, config, { latestBlock: 3, loadState: async () => state(3), loadLogs: async () => [{ ...log(3), blockHash: hash(99) }] }), /当前主链/);
  assert.equal((await readMarketCheckpoint(config)).lastBlock, 2);
  await assert.rejects(indexMarketRange({ getBlock: async () => null }, config, { latestBlock: 3 }), /缺少有效/);
  assert.equal((await readMarketCheckpoint(config)).lastBlock, 2);
});

test("旧时间升级先备份，精确校正事件/六周期/24h，保留数量与断点；失败完全不改库", async (t) => {
  const { config, directory } = await fixture(t);
  await appendMarketBatch(state(2, 120), [event(1), event(2)], config, 1_800_000_000, { fromBlock: 1 });
  withMarketDatabase(config, true, (db) => db.exec("UPDATE market_state SET header = json_remove(header, '$.history.timestampVersion')"));
  const before = await readMarketSnapshot(config, { full: true });
  await assert.rejects(ensureExactTimestamps({ getBlock: async () => null }, config), /缺少有效/);
  assert.deepEqual(await readMarketSnapshot(config, { full: true }), before);
  assert.ok((await fs.readdir(directory)).some((name) => name.includes(".backup-")));
  const provider = { getBlock: async (number) => ({ number, hash: hash(number), timestamp: 1_800_000_000 + number * 60 }) };
  const result = await ensureExactTimestamps(provider, config);
  assert.equal(result.changed, true);
  const after = await readMarketSnapshot(config, { full: true });
  assert.equal(after.history.lastBlock, 2);
  assert.equal(after.history.events.length, before.history.events.length);
  assert.deepEqual(after.history.events.map((item) => item.timestamp), [1_800_000_060, 1_800_000_120]);
  assert.equal(after.candlesByInterval["1m"].length, 2);
  assert.equal(after.candlesByInterval["1m"][0].volume, 202);
  assert.equal(after.candlesByInterval["1m"][1].volume, 204);
  assert.notEqual(after.history.datasetVersion, before.history.datasetVersion);
  assert.deepEqual(await readMarketSnapshot({ ...config, dataFile: result.backup }, { full: true }), before);
  assert.deepEqual(await ensureExactTimestamps(provider, config), { changed: false });
});

test("浅重组备份后仅移除共同锚点后的孤块；重建计数/价格/极值并允许重新追块", async (t) => {
  const { config } = await fixture(t);
  await appendMarketBatch(state(2, 120), [event(1), event(2)], config, 1_800_000_002, { fromBlock: 1, blockHash: hash(2) });
  await appendMarketBatch(state(4, 9000), [event(3, 1_800_000_003, { price: 9000 }), event(4)], config, 1_800_000_004, { fromBlock: 3, blockHash: hash(4) });
  const old = await readMarketSnapshot(config, { full: true });
  const provider = { getBlock: async (number) => ({ number, hash: hash(number >= 3 ? number + 100 : number), timestamp: 1_800_000_000 + number }) };
  const result = await reconcileChain(provider, config, 4);
  assert.equal(result.changed, true);
  const restored = await readMarketSnapshot(config, { full: true });
  assert.equal(restored.history.lastBlock, 2);
  assert.equal(restored.history.totalEvents, 2);
  assert.equal(restored.quote.priceQuote, 120);
  assert.deepEqual(restored.history.events.map((item) => item.tx), [hash(1), hash(2)]);
  assert.ok(restored.candlesByInterval["1m"].every((item) => item.high < 9000));
  assert.notEqual(restored.history.datasetVersion, old.history.datasetVersion);
  assert.ok(restored.history.revision > old.history.revision);
  assert.deepEqual(await readMarketSnapshot({ ...config, dataFile: result.backup }, { full: true }), old);
  await indexMarketRange(provider, config, { latestBlock: 4, loadLogs: async () => [], loadState: async () => state(4, 130) });
  assert.equal((await readMarketCheckpoint(config)).lastBlock, 4);
  assert.equal((await readMarketSnapshot(config)).quote.priceQuote, 130);
});

test("节点落后/超出锚点的深重组都停止写入，不把全部历史删除重扫", async (t) => {
  const { config } = await fixture(t);
  await appendMarketBatch(state(2), [event(1)], config, 1_800_000_000, { fromBlock: 1, blockHash: hash(2) });
  const before = await readMarketSnapshot(config, { full: true });
  const provider = { getBlock: async (number) => ({ number, hash: hash(number + 100), timestamp: 1_800_000_000 }) };
  await assert.rejects(reconcileChain(provider, config, 1), /低于保存断点/);
  await assert.rejects(reconcileChain(provider, config, 2), /暂停写入/);
  assert.deepEqual(await readMarketSnapshot(config, { full: true }), before);
});

test("行情新鲜度独立于有无成交：识别停扫、旧节点、追块、首次同步和正常无成交", async (t) => {
  const { config } = await fixture(t);
  const now = Date.now(), worker = { checkedAt: new Date(now).toISOString(), chainTime: Math.floor(now / 1000), observedBlock: 20 };
  const check = (overrides) => evaluateMarketHealth({ header: { history: { timestampVersion: 1 } }, indexedBlock: 20, worker, now, ...overrides });
  assert.equal(check({}).status, "healthy");
  assert.equal(check({ indexedBlock: 10 }).status, "catching_up");
  assert.equal(check({ worker: { ...worker, checkedAt: new Date(now - 91_000).toISOString() } }).status, "stale");
  assert.equal(check({ worker: { ...worker, chainTime: Math.floor(now / 1000) - 100 } }).status, "stale");
  assert.equal(check({ worker: { ...worker, error: true } }).status, "stale");
  assert.equal(check({ worker: null }).status, "unknown");
  assert.equal(check({ header: null }).status, "unready");
  assert.equal((await readMarketHealth(config)).status, "unready");
  await appendMarketBatch(state(20), [], config, Math.floor(now / 1000), { fromBlock: 1 });
  await writeWorkerStatus(config, worker);
  assert.equal((await readMarketHealth(config)).status, "healthy");
  await assert.rejects(writeWorkerStatus({ ...config, chainId: 1 }, worker), /chainId/);
});

test("断线交易补页固定区块窗口，短时超过 200 笔也可继续翻页", async (t) => {
  const { config } = await fixture(t);
  const events = Array.from({ length: 450 }, (_, index) => event(index + 1));
  await appendMarketBatch(state(450), events, config, 1_800_000_000, { fromBlock: 1 });
  const first = await readTransactionPage(config, null, 200, { afterBlock: 25, throughBlock: 440 });
  assert.equal(first.items.length, 200);
  assert.equal(first.items[0].blockNumber, 440);
  const cursor = JSON.parse(Buffer.from(first.page.nextCursor, "base64url").toString());
  const second = await readTransactionPage(config, cursor, 200, { afterBlock: 25, throughBlock: 440 });
  const cursor2 = JSON.parse(Buffer.from(second.page.nextCursor, "base64url").toString());
  const third = await readTransactionPage(config, cursor2, 200, { afterBlock: 25, throughBlock: 440 });
  assert.equal(third.page.hasMore, false);
  assert.equal(third.items.length, 15);
  assert.equal(third.items.at(-1).blockNumber, 26);
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map((item) => item.tx)).size, 415);
});

test("RPC 网络故障不二分放大请求，真正日志范围限制才缩小区间", async (t) => {
  const { config } = await fixture(t);
  let calls = 0;
  await assert.rejects(getPairLogs({ getLogs: async () => { calls++; throw Object.assign(new Error("network down"), { code: "NETWORK_ERROR" }); } }, config, 1, 2), /network down/);
  assert.equal(calls, 1);
  const ranges = [];
  await getPairLogs({ getLogs: async ({ fromBlock, toBlock }) => { ranges.push([fromBlock, toBlock]); if (fromBlock < toBlock) throw new Error("block range limit"); return []; } }, config, 1, 2);
  assert.deepEqual(ranges, [[1, 2], [1, 1], [2, 2]]);
});

test("真实时间校正收到取消不修改历史；已中止的扫描不请求 RPC 或推进断点", async (t) => {
  const { config } = await fixture(t);
  await appendMarketBatch(state(2), [event(1)], config, 1_800_000_000, { fromBlock: 1 });
  withMarketDatabase(config, true, (db) => db.exec("UPDATE market_state SET header = json_remove(header, '$.history.timestampVersion')"));
  const before = await readMarketSnapshot(config, { full: true });
  const controller = new AbortController();
  await assert.rejects(ensureExactTimestamps({ getBlock: async (number) => {
    controller.abort();
    return { number, hash: hash(number), timestamp: 1_800_000_000 + number };
  } }, config, { signal: controller.signal }), { name: "AbortError" });
  assert.deepEqual(await readMarketSnapshot(config, { full: true }), before);
  await assert.rejects(indexMarketRange({ getBlockNumber: () => { throw new Error("不应请求"); } }, config, { signal: controller.signal }), { name: "AbortError" });
});

test("进程启动校正阶段与监听阶段收到 SIGTERM 都正常释放自己的写锁并退出", async (t) => {
  const { directory } = await fixture(t);
  for (const starting of [true, false]) {
    const dataFile = path.join(directory, `lifecycle-${starting}.db`);
    const source = `
      import {runMarketProcess} from './lib/market/process-lifecycle.mjs';
      import {acquireMarketWriterLock} from './lib/market/writer-lock.mjs';
      import {setTimeout as delay} from 'node:timers/promises';
      await runMarketProcess(async(signal)=>{
        const release=await acquireMarketWriterLock({dataFile:${JSON.stringify(dataFile)}},'watch');
        if (${starting}) { try { console.log('READY'); await delay(60000,undefined,{signal}); } finally {await release();} }
        else { const keepAlive=setInterval(()=>{},1000); setImmediate(()=>console.log('READY')); return {stop:async()=>{clearInterval(keepAlive); await release();}}; }
      },{watch:true});`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
    let output = "", errorOutput = "";
    child.stderr.on("data", (data) => { errorOutput += data; });
    const exit = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`子进程没有就绪：${errorOutput}`)), 5000);
      child.stdout.on("data", (data) => { output += data; if (output.includes("READY")) { clearTimeout(timeout); resolve(); } });
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    });
    child.kill("SIGTERM");
    assert.deepEqual(await exit, { code: 0, signal: null }, errorOutput);
    await assert.rejects(fs.access(`${dataFile}.lock`), { code: "ENOENT" });
  }
});
