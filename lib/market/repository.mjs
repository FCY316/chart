import { INTERVALS } from "./config.mjs";
import { withMarketDatabase } from "./database.mjs";

export const readStateRow = (db) => db.prepare("SELECT * FROM market_state WHERE id = 1").get();
export const decodeRows = (rows) => rows.map((row) => JSON.parse(row.payload));

export function assertMarketIdentity(header, config) {
  if (header.metadata?.chainId !== config.chainId || header.metadata?.pairAddress?.toLowerCase() !== config.pairAddress.toLowerCase()) {
    throw new Error("数据的 chainId/LP 地址与环境配置不一致，请使用独立数据库路径");
  }
}

export function snapshotHeader(snapshot) {
  const header = { ...snapshot, history: { ...snapshot.history } };
  delete header.candles;
  delete header.candlesByInterval;
  delete header.transactions;
  delete header.history.events;
  delete header.history.totalEvents;
  delete header.history.transactionsCursor;
  return header;
}

export function encodeCursor(event) {
  return Buffer.from(JSON.stringify({ blockNumber: event.blockNumber ?? 0, logIndex: event.logIndex ?? 0 })).toString("base64url");
}

/** 单行 payload 保留全部事件字段；常用排序/聚合字段独立建索引，不是整份 JSON 入库。 */
export function insertEvent(db, event, lastBlock) {
  const timestamp = event.timestamp ?? Math.floor(Date.parse(event.time) / 1_000);
  if (!/^0x[\da-f]{64}$/i.test(event.tx) || !Number.isSafeInteger(event.logIndex) || event.logIndex < 0
    || !Number.isSafeInteger(event.blockNumber) || event.blockNumber < 0 || event.blockNumber > lastBlock
    || !Number.isSafeInteger(timestamp) || timestamp < 0
    || !["swap", "sync", "addLiquidity", "removeLiquidity"].includes(event.kind)) throw new Error("历史事件缺少有效的 tx/logIndex/blockNumber/timestamp/kind，拒绝推进断点");
  if (event.kind !== "sync" && ![event.price, event.baseAmount, event.quoteAmount].every((value) => Number.isFinite(value) && value >= 0)) throw new Error("历史事件价格或数量无效，拒绝推进断点");
  return db.prepare(`INSERT INTO events(tx, log_index, block_number, timestamp, kind, side, price, quote_amount, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tx, log_index) DO NOTHING`)
    .run(event.tx.toLowerCase(), event.logIndex, event.blockNumber, timestamp, event.kind, event.side ?? null, event.price ?? 0, event.quoteAmount ?? 0, JSON.stringify(event)).changes > 0;
}

export function saveCandle(db, interval, candle) {
  const timestamp = candle.timestamp ?? Math.floor(Date.parse(candle.time) / 1_000);
  if (!INTERVALS[interval] || !Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp % INTERVALS[interval] !== 0
    || ![candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)
    || candle.volume < 0 || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) throw new Error(`无效的 ${interval} K 线`);
  db.prepare(`INSERT INTO candles(interval, timestamp, payload) VALUES (?, ?, ?)
    ON CONFLICT(interval, timestamp) DO UPDATE SET payload = excluded.payload`)
    .run(interval, timestamp, JSON.stringify(candle));
}

/** 默认只读取首页需要的有界数据；full 仅用于显式导出/兼容接口。 */
export async function readMarketSnapshot(config, { full = false, candleLimit = 120, transactionLimit = 25 } = {}) {
  return withMarketDatabase(config, false, (db) => {
    const row = readStateRow(db);
    if (!row) return null;
    const header = JSON.parse(row.header);
    assertMarketIdentity(header, config);
    const candlesByInterval = Object.fromEntries(Object.keys(INTERVALS).map((interval) => {
      const rows = full
        ? db.prepare("SELECT payload FROM candles WHERE interval = ? ORDER BY timestamp ASC").all(interval)
        : db.prepare("SELECT payload FROM candles WHERE interval = ? ORDER BY timestamp DESC LIMIT ?").all(interval, candleLimit).reverse();
      return [interval, decodeRows(rows)];
    }));
    const events = full
      ? decodeRows(db.prepare("SELECT payload FROM events ORDER BY timestamp, log_index, block_number").all())
      : decodeRows(db.prepare("SELECT payload FROM events WHERE kind <> 'sync' ORDER BY block_number DESC, log_index DESC, timestamp DESC LIMIT ?").all(transactionLimit));
    const transactions = full
      ? decodeRows(db.prepare("SELECT payload FROM events WHERE kind <> 'sync' ORDER BY timestamp DESC, log_index DESC LIMIT 200").all())
      : events;
    return {
      ...header, candles: candlesByInterval["5m"], candlesByInterval, transactions,
      history: { ...header.history, revision: row.revision, events, lastBlock: row.last_block, totalEvents: row.total_transactions, transactionsCursor: !full && events.length ? encodeCursor(events.at(-1)) : null },
    };
  });
}

/** 时间范围、排序、LIMIT 都在 SQL 中执行，接口不再加载全部 K 线。 */
export async function readCandlePage(config, interval, { from, to, before, limit }) {
  if (!INTERVALS[interval] || !Number.isInteger(limit) || limit <= 0 || limit > 2_000) throw new Error("无效 K 线分页参数");
  return withMarketDatabase(config, false, (db) => {
    const row = readStateRow(db);
    if (!row) return null;
    assertMarketIdentity(JSON.parse(row.header), config);
    const conditions = ["interval = ?"], args = [interval];
    for (const [value, operator] of [[from, ">="], [to, "<="], [before, "<"]]) {
      if (Number.isFinite(value)) { conditions.push(`timestamp ${operator} ?`); args.push(value); }
    }
    const where = conditions.join(" AND ");
    const total = db.prepare(`SELECT count(*) AS n FROM candles WHERE ${where}`).get(...args).n;
    const items = decodeRows(db.prepare(`SELECT payload FROM candles WHERE ${where} ORDER BY timestamp DESC LIMIT ?`).all(...args, limit).reverse());
    const first = items[0];
    return {
      interval, items, page: { limit, total, hasMore: total > items.length, nextCursor: first ? first.timestamp ?? Math.floor(Date.parse(first.time) / 1_000) : null },
      updatedAt: JSON.parse(row.header).metadata.updatedAt, lastBlock: row.last_block, datasetVersion: JSON.parse(row.header).history?.datasetVersion ?? "initial",
    };
  });
}

export async function readTransactionPage(config, cursor, limit, { afterBlock, throughBlock } = {}) {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 200) throw new Error("无效交易分页参数");
  return withMarketDatabase(config, false, (db) => {
    const row = readStateRow(db);
    if (!row) return null;
    assertMarketIdentity(JSON.parse(row.header), config);
    let where = cursor ? "AND (block_number, log_index) < (?, ?)" : "";
    const args = cursor ? [cursor.blockNumber, cursor.logIndex] : [];
    if (Number.isSafeInteger(afterBlock)) { where += " AND block_number > ?"; args.push(afterBlock); }
    if (Number.isSafeInteger(throughBlock)) { where += " AND block_number <= ?"; args.push(throughBlock); }
    const rows = db.prepare(`SELECT payload FROM events WHERE kind <> 'sync' ${where} ORDER BY block_number DESC, log_index DESC, timestamp DESC LIMIT ?`).all(...args, limit + 1);
    const items = decodeRows(rows.slice(0, limit));
    const hasMore = rows.length > limit;
    return { items, page: { limit, total: row.total_transactions, hasMore, nextCursor: hasMore ? encodeCursor(items.at(-1)) : null }, updatedAt: JSON.parse(row.header).metadata.updatedAt, lastBlock: row.last_block, datasetVersion: JSON.parse(row.header).history?.datasetVersion ?? "initial" };
  });
}

export async function readMarketCheckpoint(config) {
  return withMarketDatabase(config, false, (db) => {
    const row = readStateRow(db);
    if (row) assertMarketIdentity(JSON.parse(row.header), config);
    return row ? { lastBlock: row.last_block, revision: row.revision, events: row.total_events, reserves: JSON.parse(row.header).pool.reserves, blockHash: JSON.parse(row.header).history?.blockHash } : null;
  });
}
