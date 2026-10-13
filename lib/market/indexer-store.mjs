import { buildCandles, buildMarketHeader } from "./aggregation.mjs";
import { INTERVALS, isoTime } from "./config.mjs";
import { withMarketDatabase } from "./database.mjs";
import { assertMarketIdentity, decodeRows, insertEvent, readStateRow, saveCandle, snapshotHeader } from "./repository.mjs";

const PENDING_WALLET = `kind <> 'sync' AND (
  coalesce(json_extract(payload, '$.walletSource'), '') <> 'transaction.from'
  OR coalesce(lower(json_extract(payload, '$.wallet')), '') <> coalesce(lower(json_extract(payload, '$.transactionFrom')), '')
  OR length(coalesce(json_extract(payload, '$.transactionFrom'), '')) <> 42
  OR lower(substr(coalesce(json_extract(payload, '$.transactionFrom'), ''), 1, 2)) <> '0x'
  OR lower(substr(coalesce(json_extract(payload, '$.transactionFrom'), ''), 3)) GLOB '*[^0-9a-f]*')`;

export function statistics(db, price, now) {
  const start = now - 86_400;
  const recent = db.prepare(`SELECT count(*) AS trades24h, coalesce(sum(quote_amount), 0) AS volume24h,
    max(nullif(price, 0)) AS high24h, min(nullif(price, 0)) AS low24h,
    coalesce(sum(side = 'Buy'), 0) AS buys24h, coalesce(sum(side = 'Sell'), 0) AS sells24h
    FROM events WHERE kind = 'swap' AND timestamp >= ? AND timestamp <= ?`).get(start, now);
  const before = db.prepare("SELECT price FROM events WHERE kind = 'swap' AND timestamp < ? ORDER BY timestamp DESC, log_index DESC LIMIT 1").get(start);
  const firstRecent = db.prepare("SELECT price FROM events WHERE kind = 'swap' AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp, log_index LIMIT 1").get(start, now);
  const reference = before?.price || firstRecent?.price || price;
  return { ...recent, high24h: recent.high24h ?? price, low24h: recent.low24h ?? price, referencePrice24h: reference, change24h: reference > 0 ? (price / reference - 1) * 100 : 0 };
}

/** 只重算本批事件涉及的时间桶，再更新当前池子价格柱，不遍历全历史。 */
export function updateCandles(db, events, price, now) {
  for (const [interval, seconds] of Object.entries(INTERVALS)) {
    const touched = new Set(events.filter((event) => event.kind !== "sync" && event.price > 0).map((event) => Math.floor(event.timestamp / seconds) * seconds));
    for (const timestamp of touched) {
      const source = db.prepare("SELECT payload, timestamp FROM events WHERE timestamp >= ? AND timestamp < ? AND kind <> 'sync' AND price > 0 ORDER BY timestamp, log_index, block_number")
        .all(timestamp, timestamp + seconds).map((row) => ({ ...JSON.parse(row.payload), timestamp: row.timestamp }));
      const candle = buildCandles(source, seconds)[0];
      if (!candle) continue;
      const existingRow = db.prepare("SELECT payload FROM candles WHERE interval = ? AND timestamp = ?").get(interval, timestamp);
      const existing = existingRow ? JSON.parse(existingRow.payload) : null;
      // 历史柱曾包含实时储备价，保留已记录极值，不因下一批事件重算而抹掉。
      saveCandle(db, interval, existing ? { ...existing, ...candle, high: Math.max(existing.high, candle.high), low: Math.min(existing.low, candle.low) } : candle);
    }
    if (!Number.isFinite(price) || price <= 0) continue;
    const timestamp = Math.floor(now / seconds) * seconds;
    const existingRow = db.prepare("SELECT payload FROM candles WHERE interval = ? AND timestamp = ?").get(interval, timestamp);
    if (existingRow) {
      const candle = JSON.parse(existingRow.payload);
      saveCandle(db, interval, { ...candle, high: Math.max(candle.high, price), low: Math.min(candle.low, price), close: price });
    } else {
      const previousRow = db.prepare("SELECT payload FROM candles WHERE interval = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT 1").get(interval, timestamp);
      const open = previousRow ? JSON.parse(previousRow.payload).close : price;
      saveCandle(db, interval, { time: isoTime(timestamp), timestamp, open, high: Math.max(open, price), low: Math.min(open, price), close: price, volume: 0, trades: 0 });
    }
  }
}

/** 事件、K 线、指标、断点一次提交；任何一行校验/磁盘写入失败都会回滚整批。 */
export async function appendMarketBatch(state, events, config, now, { fromBlock, advanceCheckpoint = true, blockHash } = {}) {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(state.blockNumber) || !Number.isFinite(state.price) || state.price < 0) throw new Error("无效区块状态或时间");
  return withMarketDatabase(config, true, (db) => {
    const previous = readStateRow(db);
    if (previous) {
      const header = JSON.parse(previous.header);
      assertMarketIdentity(header, config);
      if (header.history?.candleVolumeVersion !== 1) throw new Error("请先重启新版 watcher/sync，完成历史成交量修复");
    }
    const previousBlock = previous?.last_block ?? config.startBlock - 1;
    if (advanceCheckpoint && state.blockNumber < previousBlock) throw new Error("拒绝回退已保存的扫块断点");
    if (fromBlock !== undefined && fromBlock !== previousBlock + 1) throw new Error("扫块断点已改变或区块范围不连续，请重新读取断点");
    if (!advanceCheckpoint && events.length) throw new Error("仅刷新储备时不能写入未扫描事件");
    const inserted = [];
    for (const original of events) {
      const event = { ...original, timestamp: original.timestamp ?? Math.floor(Date.parse(original.time) / 1_000) };
      if (fromBlock !== undefined && event.blockNumber < fromBlock) throw new Error("事件超出本批扫描范围");
      if ((event.kind === "addLiquidity" || event.kind === "removeLiquidity") && !event.price && event.baseAmount > 0) event.price = event.quoteAmount / event.baseAmount;
      if (insertEvent(db, event, state.blockNumber)) inserted.push(event);
    }
    updateCandles(db, inserted, state.price, now);
    const trades = (previous?.total_trades ?? 0) + inserted.filter((event) => event.kind === "swap").length;
    const transactions = (previous?.total_transactions ?? 0) + inserted.filter((event) => event.kind !== "sync").length;
    const totalEvents = (previous?.total_events ?? 0) + inserted.length;
    const firstRow = db.prepare("SELECT payload FROM events WHERE kind = 'swap' ORDER BY timestamp, log_index LIMIT 1").get();
    const header = buildMarketHeader(state, config, now, statistics(db, state.price, now), trades, firstRow ? JSON.parse(firstRow.payload) : undefined);
    const oldHistory = previous ? JSON.parse(previous.header).history : {};
    Object.assign(header.history, {
      timestampVersion: oldHistory.timestampVersion ?? (previous ? 0 : 1),
      datasetVersion: oldHistory.datasetVersion ?? "initial",
      indexedAt: new Date().toISOString(),
      ...(blockHash ? { blockHash } : oldHistory.blockHash ? { blockHash: oldHistory.blockHash } : {}),
    });
    const lastBlock = advanceCheckpoint ? state.blockNumber : previousBlock;
    header.history.lastBlock = lastBlock;
    db.prepare(`INSERT INTO market_state VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET header = excluded.header, last_block = excluded.last_block,
      total_events = excluded.total_events, total_transactions = excluded.total_transactions,
      total_trades = excluded.total_trades, revision = excluded.revision`)
      .run(JSON.stringify(snapshotHeader(header)), lastBlock, totalEvents, transactions, trades, (previous?.revision ?? 0) + 1);
    if (blockHash && advanceCheckpoint) {
      db.prepare("INSERT OR REPLACE INTO chain_checkpoints VALUES (?, ?, ?, ?)").run(lastBlock, blockHash, now, JSON.stringify(snapshotHeader(header)));
      // 只限制重组锚点数量，不清除历史事件或 K 线。更深重组拒绝自动回退。
      db.exec("DELETE FROM chain_checkpoints WHERE block_number NOT IN (SELECT block_number FROM chain_checkpoints ORDER BY block_number DESC LIMIT 512)");
    }
    return { lastBlock, addedEvents: inserted.length, totalEvents };
  });
}

/** 离线地址补齐只选待修复行；不会加载/重写 K 线。 */
export async function readWalletCandidates(config) {
  return withMarketDatabase(config, false, (db) => {
    const state = readStateRow(db);
    if (!state) throw new Error("行情尚未就绪，请先导入或同步");
    assertMarketIdentity(JSON.parse(state.header), config);
    const rows = db.prepare(`SELECT payload FROM events WHERE ${PENDING_WALLET} ORDER BY block_number, log_index`).all();
    return { events: decodeRows(rows), revision: state.revision };
  });
}

/** 启动警告只取一行，不因多年未补齐地址而将全部待修复记录加载进内存。 */
export async function hasPendingMarketWallets(config) {
  return withMarketDatabase(config, false, (db) => Boolean(db.prepare(`SELECT 1 FROM events WHERE ${PENDING_WALLET} LIMIT 1`).get()));
}

export async function updateMarketWallets(config, events, revision) {
  return withMarketDatabase(config, true, (db) => {
    const state = readStateRow(db);
    if (!state || state.revision !== revision) throw new Error("补齐期间数据库被其他进程修改；已中止写入，请停止 watcher 后重试");
    for (const event of events) {
      const result = db.prepare("UPDATE events SET payload = ? WHERE tx = ? AND log_index = ?").run(JSON.stringify(event), event.tx.toLowerCase(), event.logIndex);
      if (result.changes !== 1) throw new Error("待补齐交易不存在，已回滚");
    }
    db.prepare("UPDATE market_state SET revision = revision + 1 WHERE id = 1").run();
  });
}
