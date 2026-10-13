import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getAddress } from "ethers";
import { pairInterface } from "../lib/market/contracts.mjs";
import { parsePairLog } from "../lib/market/events.mjs";
import { resolveEventWallets } from "../lib/market/wallets.mjs";
import { backfillMarketWallets } from "../lib/market/wallet-backfill.mjs";
import { acquireMarketWriterLock } from "../lib/market/writer-lock.mjs";
import { getMarketConfig } from "../lib/market/config.mjs";
import { appendMarketBatch } from "../lib/market/indexer-store.mjs";
import { readMarketSnapshot } from "../lib/market/repository.mjs";
import { withMarketDatabase } from "../lib/market/database.mjs";

const router = "0x2C8F2A60B72EDaD2eA4445A2714982C927AE10AD";
const trader = getAddress("0x675d6c9ef24109a5524cf6f8a3c27771149c172a");
const hash = (index) => `0x${index.toString(16).padStart(64, "0")}`;
const state = { displayBaseIndex: 0, displayBaseToken: { decimals: 18 }, displayQuoteToken: { decimals: 18 } };
const unit = 10n ** 18n;
const event = (index, side = "Buy") => ({ kind: side === "Buy" ? "swap" : "addLiquidity", side, tx: hash(index), blockNumber: 10, logIndex: index, wallet: router, sender: router, baseAmount: 2, quoteAmount: 3600, price: 1800, timestamp: 1000, time: new Date(1_000_000).toISOString() });

test("Swap/Mint/Burn 先保留日志信息，再用真实交易 from 填写交易者", async () => {
  const specs = [
    ["Swap", [router, 0n, 3600n * unit, 2n * unit, 0n, router], "Buy"],
    ["Swap", [router, 2n * unit, 0n, 0n, 3600n * unit, trader], "Sell"],
    ["Mint", [router, 2n * unit, 3600n * unit], "AddLiquidity"],
    ["Burn", [router, 2n * unit, 3600n * unit, router], "RemoveLiquidity"],
  ];
  const parsed = specs.map(([name, args, side], index) => {
    const encoded = pairInterface.encodeEventLog(pairInterface.getEvent(name), args);
    const result = parsePairLog({ ...encoded, transactionHash: hash(index), blockNumber: 10, index }, state, 1000);
    assert.equal(result.side, side);
    assert.equal(result.wallet, "");
    assert.equal(result.sender, router);
    return result;
  });
  const resolved = await resolveEventWallets({ getTransaction: async (hash) => ({ hash, from: trader }) }, parsed);
  for (const row of resolved) {
    assert.equal(row.wallet, trader);
    assert.equal(row.transactionFrom, trader);
    assert.equal(row.walletSource, "transaction.from");
    assert.equal(row.baseAmount, 2);
    assert.equal(row.quoteAmount, 3600);
  }
});

test("相同交易去重，Sync 不查询，查询限制并发，旧记录不原地修改", async () => {
  const rows = [event(1), { ...event(1, "AddLiquidity"), logIndex: 2 }, { kind: "sync", tx: hash(2) }, ...[3, 4, 5, 6].map((index) => event(index))];
  const original = structuredClone(rows);
  let calls = 0, active = 0, maximum = 0;
  const provider = { getTransaction: async (hash) => {
    calls += 1;
    maximum = Math.max(maximum, ++active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return { hash, from: trader };
  } };
  const resolved = await resolveEventWallets(provider, rows, { concurrency: 2 });
  assert.equal(calls, 5);
  assert.ok(maximum <= 2);
  assert.deepEqual(rows, original);
  assert.equal(resolved[0].legacyWallet, router);
  assert.deepEqual(resolved[2], rows[2]);
  await resolveEventWallets(provider, resolved);
  assert.equal(calls, 5, "重复补齐不重新查询已解析的交易");
});

test("RPC 返回 null 会重试，最终失败不得回退为合约地址", async () => {
  let calls = 0;
  const provider = { getTransaction: async (hash) => ++calls === 1 ? null : { hash, from: trader } };
  const result = await resolveEventWallets(provider, [event(1)], { retryDelayMs: 0 });
  assert.equal(result[0].wallet, trader);
  assert.equal(calls, 2);
  await assert.rejects(resolveEventWallets({ getTransaction: async () => null }, [event(1)], { attempts: 1 }), /读取交易发起地址失败/);
  await assert.rejects(resolveEventWallets({ getTransaction: async () => ({ hash: hash(99), from: trader }) }, [event(1)], { attempts: 1 }), /交易哈希不匹配/);
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chart-wallet-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = getMarketConfig({ MARKET_DATA_FILE: path.join(directory, "market.db"), MARKET_START_BLOCK: "1" });
  const token = { name: "Token", decimals: 18, address: trader };
  await appendMarketBatch({ blockNumber: 99, price: 1800, factory: router, displayBaseToken: { ...token, symbol: "HUGE" }, displayQuoteToken: { ...token, symbol: "NFX" }, displayBaseReserve: 2, displayQuoteReserve: 3600 },
    [event(1), event(2, "AddLiquidity"), { ...event(3), kind: "sync" }], config, 1000, { fromBlock: 1 });
  const snapshot = await readMarketSnapshot(config, { full: true });
  const original = await readMarketSnapshot(config, { full: true });
  return { config, snapshot, original, directory };
}

test("历史补齐原子写入、自动精确备份，K 线／价格／金额／事件数／断点不变", async (t) => {
  const { config, snapshot, original } = await fixture(t);
  let calls = 0, destroyed = false;
  const result = await backfillMarketWallets(config, { createProvider: () => ({ getTransaction: async (hash) => { calls += 1; return { hash, from: trader }; }, destroy: async () => { destroyed = true; } }) });
  assert.equal(calls, 2);
  assert.ok(destroyed);
  assert.equal(result.updatedEvents, 2);
  assert.deepEqual(await readMarketSnapshot({ ...config, dataFile: result.backupFile }, { full: true }), original);
  const repaired = await readMarketSnapshot(config, { full: true });
  for (const field of ["metadata", "quote", "metrics", "pool", "candles", "candlesByInterval"]) assert.deepEqual(repaired[field], snapshot[field]);
  assert.equal(repaired.history.lastBlock, snapshot.history.lastBlock);
  assert.equal(repaired.history.lastSyncAt, snapshot.history.lastSyncAt);
  assert.equal(repaired.history.events.length, snapshot.history.events.length);
  for (const row of [...repaired.history.events, ...repaired.transactions]) {
    if (row.kind === "sync") continue;
    assert.equal(row.wallet, trader);
    assert.equal(row.baseAmount, 2);
    assert.equal(row.quoteAmount, 3600);
    assert.equal(row.sender, router);
  }
  const again = await backfillMarketWallets(config, { createProvider: () => { throw new Error("不应联网"); } });
  assert.equal(again.changed, false);
  await assert.rejects(fs.access(`${config.dataFile}.lock`));
});

test("写入锁拒绝与 watcher 并行；补齐失败保留原文件和备份并释放锁", async (t) => {
  const { config, original } = await fixture(t);
  const release = await acquireMarketWriterLock(config, "watch-test");
  await assert.rejects(backfillMarketWallets(config), /请先停止 watcher/);
  await release();
  let backup;
  await assert.rejects(backfillMarketWallets(config, {
    onBackup: (file) => { backup = file; },
    createProvider: () => ({ getTransaction: async () => { throw new Error("节点离线"); }, destroy: async () => {} }),
  }), /读取交易发起地址失败/);
  assert.deepEqual(await readMarketSnapshot(config, { full: true }), original);
  assert.deepEqual(await readMarketSnapshot({ ...config, dataFile: backup }, { full: true }), original);
  await assert.rejects(fs.access(`${config.dataFile}.lock`));
});

test("非协作写入者在补齐期间修改数据库时拒绝覆盖更新的数据", async (t) => {
  const { config } = await fixture(t);
  await assert.rejects(backfillMarketWallets(config, { createProvider: () => ({
    getTransaction: async (hash) => { withMarketDatabase(config, true, (db) => db.exec("UPDATE market_state SET revision = revision + 1, last_block = 100")); return { hash, from: trader }; },
    destroy: async () => {},
  }) }), /被其他进程修改/);
  const updated = await readMarketSnapshot(config, { full: true });
  assert.equal(updated.history.lastBlock, 100);
  assert.equal(updated.history.events[0].wallet, router);
});
