import type { Candle, MarketSnapshot, Transaction } from "@/lib/market";

export const DEFAULT_CANDLE_LIMIT = 1_000;
export const MAX_CANDLE_LIMIT = 2_000;
export const DEFAULT_TRANSACTION_LIMIT = 50;
export const MAX_TRANSACTION_LIMIT = 200;
export const SUMMARY_CANDLE_LIMIT = 120;
export const SUMMARY_TRANSACTION_LIMIT = 25;

type MarketEventRecord = Transaction & { blockNumber?: number; logIndex?: number; timestamp?: number; kind?: string };

function candleTimestamp(candle: Candle) {
  if (typeof candle.timestamp === "number") return candle.timestamp;
  return Math.floor(Date.parse(candle.time) / 1_000);
}

function eventTimestamp(event: MarketEventRecord) {
  return (event.timestamp ?? Math.floor(Date.parse(event.time) / 1_000)) || 0;
}

function eventSortDescending(a: MarketEventRecord, b: MarketEventRecord) {
  return (b.blockNumber ?? 0) - (a.blockNumber ?? 0)
    || (b.logIndex ?? 0) - (a.logIndex ?? 0)
    || eventTimestamp(b) - eventTimestamp(a);
}

function eventKey(event: MarketEventRecord) {
  return `${event.tx}:${event.logIndex ?? ""}`;
}

export function parseLimit(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function encodeTransactionCursor(event: MarketEventRecord) {
  const value = JSON.stringify({ blockNumber: event.blockNumber ?? 0, logIndex: event.logIndex ?? 0 });
  return Buffer.from(value).toString("base64url");
}

export function decodeTransactionCursor(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { blockNumber?: number; logIndex?: number };
    if (!Number.isFinite(parsed.blockNumber) || !Number.isFinite(parsed.logIndex)) return null;
    return { blockNumber: Number(parsed.blockNumber), logIndex: Number(parsed.logIndex) };
  } catch {
    return null;
  }
}

function compactCandleMap(snapshot: MarketSnapshot, limit: number) {
  return Object.fromEntries(
    Object.entries(snapshot.candlesByInterval ?? {}).map(([interval, candles]) => [interval, candles.slice(-limit)]),
  );
}

function allTransactions(snapshot: MarketSnapshot) {
  return ((snapshot.history?.events ?? []) as MarketEventRecord[])
    .filter((event) => event.kind !== "sync")
    .sort(eventSortDescending);
}

/**
 * Keep the current endpoint bounded. Full history remains in market.json and is
 * exposed through the candles/transactions pagination endpoints.
 */
export function compactMarketSnapshot(snapshot: MarketSnapshot): MarketSnapshot {
  const transactions = allTransactions(snapshot);
  const recentEvents = transactions.slice(0, SUMMARY_TRANSACTION_LIMIT);
  const oldestRecent = recentEvents.at(-1);
  const history = snapshot.history;
  return {
    ...snapshot,
    candles: (snapshot.candlesByInterval?.["5m"] ?? snapshot.candles).slice(-SUMMARY_CANDLE_LIMIT),
    candlesByInterval: compactCandleMap(snapshot, SUMMARY_CANDLE_LIMIT),
    transactions: snapshot.transactions.slice(0, SUMMARY_TRANSACTION_LIMIT),
    history: history ? {
      ...history,
      events: recentEvents,
      totalEvents: transactions.length,
      transactionsCursor: oldestRecent ? encodeTransactionCursor(oldestRecent) : null,
    } : history,
  };
}

export function getCandlePage(
  snapshot: MarketSnapshot,
  interval: string,
  options: { from?: number; to?: number; before?: number; limit: number },
) {
  const source = snapshot.candlesByInterval?.[interval] ?? [];
  const filtered = source
    .filter((candle) => {
      const timestamp = candleTimestamp(candle);
      return (!Number.isFinite(options.from) || timestamp >= options.from!)
        && (!Number.isFinite(options.to) || timestamp <= options.to!)
        && (!Number.isFinite(options.before) || timestamp < options.before!);
    })
    .sort((a, b) => candleTimestamp(a) - candleTimestamp(b));
  const items = filtered.length > options.limit ? filtered.slice(-options.limit) : filtered;
  const firstTimestamp = items[0] ? candleTimestamp(items[0]) : null;
  return {
    interval,
    items,
    page: {
      limit: options.limit,
      total: filtered.length,
      hasMore: firstTimestamp !== null && filtered.some((candle) => candleTimestamp(candle) < firstTimestamp),
      nextCursor: firstTimestamp,
    },
  };
}

export function getTransactionPage(snapshot: MarketSnapshot, cursor: string | null, limit: number) {
  const all = allTransactions(snapshot);
  const decoded = decodeTransactionCursor(cursor);
  const filtered = decoded
    ? all.filter((event) => (event.blockNumber ?? 0) < decoded.blockNumber
      || ((event.blockNumber ?? 0) === decoded.blockNumber && (event.logIndex ?? 0) < decoded.logIndex))
    : all;
  const items = filtered.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    page: {
      limit,
      total: all.length,
      hasMore: filtered.length > items.length,
      nextCursor: last && filtered.length > items.length ? encodeTransactionCursor(last) : null,
    },
  };
}

export function mergeTransactionEvents(snapshot: MarketSnapshot, incoming: MarketEventRecord[]) {
  const events = new Map(((snapshot.history?.events ?? []) as MarketEventRecord[]).map((event) => [eventKey(event), event]));
  for (const event of incoming) events.set(eventKey(event), event);
  return [...events.values()].sort((a, b) => (a.blockNumber ?? 0) - (b.blockNumber ?? 0) || (a.logIndex ?? 0) - (b.logIndex ?? 0));
}
