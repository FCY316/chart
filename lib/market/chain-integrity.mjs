import { randomUUID } from "node:crypto";
import { INTERVALS, isoTime } from "./config.mjs";
import { withMarketDatabase } from "./database.mjs";
import { backupMarketDatabase } from "./data-maintenance.mjs";
import { assertMarketIdentity, readStateRow, saveCandle } from "./repository.mjs";
import { buildMarketHeader } from "./aggregation.mjs";
import { statistics, updateCandles } from "./indexer-store.mjs";

/** 不以本机时间或平均出块时间替代 RPC 失败；失败就不推进断点。 */
export async function readChainBlock(provider, number) {
  const block = await provider.getBlock(number);
  if (!block || block.number !== number || !Number.isSafeInteger(block.timestamp) || block.timestamp < 0
    || !/^0x[\da-f]{64}$/i.test(block.hash ?? "")) throw new Error(`区块 ${number} 缺少有效高度、时间或哈希`);
  return { number, timestamp: block.timestamp, hash: block.hash.toLowerCase() };
}

/** 同一区块的多个日志只查询一次，限制 RPC 并发，避免首次追块压垮节点。 */
export async function readEventBlocks(provider, numbers, { signal } = {}) {
  const unique = [...new Set(numbers)], result = new Map();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, async () => {
    while (cursor < unique.length) {
      signal?.throwIfAborted();
      const number = unique[cursor++];
      result.set(number, await readChainBlock(provider, number));
    }
  }));
  return result;
}

function stateFromHeader(header, blockNumber) {
  return {
    blockNumber, price: header.quote.priceQuote ?? header.quote.priceNative,
    displayBaseToken: header.metadata.baseToken, displayQuoteToken: header.metadata.quoteToken,
    displayBaseReserve: header.pool.reserves.base, displayQuoteReserve: header.pool.reserves.quote,
    factory: header.pool.factoryAddress,
  };
}

/** 修正时间/重组后流式重建派生数据。仅维护时运行，不把完整历史装进 JS 数组。 */
function rebuildDerived(db, config, sourceHeader, lastBlock, now) {
  db.exec("DELETE FROM candles");
  for (const [interval, seconds] of Object.entries(INTERVALS)) {
    let candle;
    for (const event of db.prepare("SELECT timestamp, kind, price, quote_amount FROM events WHERE kind <> 'sync' AND price > 0 ORDER BY timestamp, block_number, log_index").iterate()) {
      const timestamp = Math.floor(event.timestamp / seconds) * seconds;
      if (!candle || candle.timestamp !== timestamp) {
        if (candle) saveCandle(db, interval, candle);
        candle = { timestamp, time: isoTime(timestamp), open: event.price, high: event.price, low: event.price, close: event.price, volume: 0, trades: 0 };
      }
      candle.high = Math.max(candle.high, event.price);
      candle.low = Math.min(candle.low, event.price);
      candle.close = event.price;
      if (event.kind === "swap") { candle.volume += event.quote_amount; candle.trades += 1; }
    }
    if (candle) saveCandle(db, interval, candle);
  }
  const state = stateFromHeader(sourceHeader, lastBlock);
  updateCandles(db, [], state.price, now);
  const counts = db.prepare("SELECT count(*) AS events, coalesce(sum(kind <> 'sync'), 0) AS transactions, coalesce(sum(kind = 'swap'), 0) AS trades FROM events").get();
  const first = db.prepare("SELECT payload FROM events WHERE kind = 'swap' ORDER BY timestamp, block_number, log_index LIMIT 1").get();
  const header = buildMarketHeader(state, config, now, statistics(db, state.price, now), counts.trades, first ? JSON.parse(first.payload) : undefined);
  Object.assign(header.history, {
    ...sourceHeader.history, events: [], lastBlock, lastSyncAt: isoTime(now),
    timestampVersion: 1, candleVolumeVersion: 1, datasetVersion: randomUUID(), indexedAt: new Date().toISOString(),
  });
  db.prepare("UPDATE market_state SET header = ?, last_block = ?, total_events = ?, total_transactions = ?, total_trades = ?, revision = revision + 1 WHERE id = 1")
    .run(JSON.stringify(header), lastBlock, counts.events, counts.transactions, counts.trades);
  return header;
}

/** 旧库一次性校正真实时间。先备份，RPC 全部成功、修订号仍一致才原子提交。调用方持写锁。 */
export async function ensureExactTimestamps(provider, config, { onProgress = () => {}, signal } = {}) {
  signal?.throwIfAborted();
  const previous = withMarketDatabase(config, false, (db) => {
    const row = readStateRow(db);
    if (!row) return null;
    const header = JSON.parse(row.header);
    assertMarketIdentity(header, config);
    return header.history?.timestampVersion === 1 ? null : {
      row, header, numbers: db.prepare("SELECT DISTINCT block_number FROM events ORDER BY block_number").all().map((item) => item.block_number),
    };
  });
  if (!previous) return { changed: false };
  const backup = await backupMarketDatabase(config);
  onProgress(`校正历史区块时间，${previous.numbers.length} 个活动区块；备份：${backup}`);
  const blocks = await readEventBlocks(provider, [...previous.numbers, previous.row.last_block], { signal });
  const tip = blocks.get(previous.row.last_block);
  const checked = await readChainBlock(provider, tip.number);
  signal?.throwIfAborted();
  if (checked.hash !== tip.hash) throw new Error("校正时间期间发生链重组，原数据库未修改，请重试");
  withMarketDatabase(config, true, (db) => {
    if (readStateRow(db)?.revision !== previous.row.revision) throw new Error("时间校正期间数据库已改变，拒绝写入");
    const update = db.prepare("UPDATE events SET timestamp = ?, payload = json_set(payload, '$.timestamp', ?, '$.time', ?, '$.blockHash', ?) WHERE block_number = ?");
    for (const number of previous.numbers) {
      const block = blocks.get(number);
      update.run(block.timestamp, block.timestamp, isoTime(block.timestamp), block.hash, number);
    }
    const header = rebuildDerived(db, config, previous.header, tip.number, tip.timestamp);
    header.history.blockHash = tip.hash;
    db.prepare("UPDATE market_state SET header = ? WHERE id = 1").run(JSON.stringify(header));
    db.prepare("INSERT OR REPLACE INTO chain_checkpoints VALUES (?, ?, ?, ?)").run(tip.number, tip.hash, tip.timestamp, JSON.stringify(header));
  });
  return { changed: true, backup, blocks: previous.numbers.length };
}

/** 验证保存断点属于当前主链。仅删除共同锚点之后的孤块事件，不清除有效历史。 */
export async function reconcileChain(provider, config, target, { signal } = {}) {
  signal?.throwIfAborted();
  const saved = withMarketDatabase(config, false, (db) => {
    const row = readStateRow(db);
    if (!row) return null;
    const header = JSON.parse(row.header);
    assertMarketIdentity(header, config);
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'chain_checkpoints'").get();
    return { row, header, anchors: hasTable ? db.prepare("SELECT * FROM chain_checkpoints ORDER BY block_number DESC").all() : [] };
  });
  if (!saved) return { changed: false };
  // 节点暂时落后不代表主链回滚，拒绝删除数据，等待节点恢复。
  if (target < saved.row.last_block) throw new Error("RPC 高度低于保存断点，暂停写入，等待节点恢复");
  const expected = saved.header.history?.blockHash;
  if (!expected) return { changed: false }; // 旧库由真实时间升级建立首个可信锚点。
  if ((await readChainBlock(provider, saved.row.last_block)).hash === expected) return { changed: false };
  let ancestor;
  for (const anchor of saved.anchors) {
    signal?.throwIfAborted();
    if ((await readChainBlock(provider, anchor.block_number)).hash === anchor.hash) { ancestor = anchor; break; }
  }
  if (!ancestor) throw new Error("链重组超过已保存的 512 个批次锚点；已暂停写入，请保留数据库并人工核查，不能删除数据库");
  const backup = await backupMarketDatabase(config);
  if ((await readChainBlock(provider, ancestor.block_number)).hash !== ancestor.hash) throw new Error("回退前共同区块再次改变，原库未修改，请重试");
  signal?.throwIfAborted();
  withMarketDatabase(config, true, (db) => {
    if (readStateRow(db)?.revision !== saved.row.revision) throw new Error("重组修复期间数据库已改变，拒绝回退");
    db.prepare("DELETE FROM events WHERE block_number > ?").run(ancestor.block_number);
    db.prepare("DELETE FROM chain_checkpoints WHERE block_number > ?").run(ancestor.block_number);
    rebuildDerived(db, config, JSON.parse(ancestor.header), ancestor.block_number, ancestor.timestamp);
  });
  console.warn(`[market] 检测到链重组，回退到共同区块 ${ancestor.block_number} 并重新追块；备份：${backup}`);
  return { changed: true, lastBlock: ancestor.block_number, backup };
}
