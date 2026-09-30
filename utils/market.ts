import type { Candle, MarketSnapshot, Transaction } from "@/lib/market";

export type MarketInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export type MarketEvent = Transaction & { kind?: string; timestamp?: number; sender?: string };
export type MarketStreamUpdate = {
  type: "market:update";
  metadata: { updatedAt: string };
  quote: MarketSnapshot["quote"];
  pool: Pick<MarketSnapshot["pool"], "lastBlock" | "reserves" | "liquidityQuote">;
  candlesByInterval: Partial<Record<MarketInterval, Candle[]>>;
  history: { events: MarketEvent[]; lastBlock: number; lastSyncAt: string; totalEvents?: number };
};

export const MARKET_INTERVAL_SECONDS: Record<MarketInterval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3_600,
  "4h": 14_400,
  "1d": 86_400,
};

export function formatNumber(value: number, maximumFractionDigits = 4) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

export function formatPrice(value: number) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value);
}

/**
 * Pool spot price: NFX per HUGE. Reserves are the source of truth for the
 * current pool price; the quote field remains a fallback for older snapshots.
 */
export function getPoolPrice(market: MarketSnapshot) {
  const reserves = market.pool.reserves;
  if (reserves && Number.isFinite(reserves.base) && reserves.base > 0 && Number.isFinite(reserves.quote)) {
    return reserves.quote / reserves.base;
  }
  return market.quote.priceQuote ?? market.quote.priceNative ?? 0;
}

export function maskAddress(value: string) {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export function formatEventTime(value: string, includeYear = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  // PC 使用完整日期，移动端保留紧凑日期。这样历史交易不会误看成今天，
  // 且不依赖不同浏览器的本地化分隔符；时间按用户设备所在时区显示。
  const twoDigits = (number: number) => String(number).padStart(2, "0");
  const day = `${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
  const clock = `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`;
  return includeYear ? `${date.getFullYear()}-${day} ${clock}` : `${day} ${clock.slice(0, 5)}`;
}

export async function copyAddress(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the legacy clipboard path when permissions block the API.
    }
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "true");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  return copied;
}

export function getMarketEvents(market: MarketSnapshot): MarketEvent[] {
  const events = (market.history?.events ?? []) as MarketEvent[];
  if (events.length > 0) {
    return events
      .filter((event) => event.kind !== "sync")
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  }
  return market.transactions as MarketEvent[];
}

function eventKey(event: MarketEvent) {
  return `${event.tx}:${event.logIndex ?? ""}`;
}

/** Merge the compact SSE update into the full snapshot loaded on page start. */
export function mergeMarketStreamUpdate(market: MarketSnapshot, update: MarketStreamUpdate): MarketSnapshot {
  // 慢 HTTP 响应不能覆盖先到达的更新区块行情。
  if (update.history.lastBlock < (market.history?.lastBlock ?? 0)) return market;
  const events = new Map(((market.history?.events ?? []) as MarketEvent[]).map((event) => [eventKey(event), event]));
  for (const event of update.history.events) events.set(eventKey(event), event);
  const mergedEvents = [...events.values()].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  const candlesByInterval: Partial<Record<MarketInterval, Candle[]>> = { ...(market.candlesByInterval ?? {}) };
  for (const [rawKey, rawIncoming] of Object.entries(update.candlesByInterval)) {
    const key = rawKey as MarketInterval;
    const incoming = rawIncoming as Candle[] | undefined;
    if (!incoming) continue;
    const candles = new Map((candlesByInterval[key] ?? []).map((candle) => [candleTimestamp(candle), candle]));
    for (const candle of incoming) candles.set(candleTimestamp(candle), candle);
    candlesByInterval[key] = [...candles.values()].sort((a, b) => candleTimestamp(a) - candleTimestamp(b));
  }

  return {
    ...market,
    metadata: { ...market.metadata, updatedAt: update.metadata.updatedAt },
    quote: update.quote,
    pool: { ...market.pool, ...update.pool },
    candles: candlesByInterval["5m"] ?? market.candles,
    candlesByInterval,
    transactions: market.transactions,
    history: {
      ...(market.history ?? { events: [], lastBlock: 0, lastSyncAt: update.metadata.updatedAt }),
      events: mergedEvents,
      lastBlock: update.history.lastBlock,
      lastSyncAt: update.history.lastSyncAt,
      totalEvents: update.history.totalEvents ?? market.history?.totalEvents,
    },
    fetchedAt: update.metadata.updatedAt,
  };
}

export function candleTimestamp(candle: Candle) {
  const timestamp = (candle as Candle & { timestamp?: number }).timestamp;
  return typeof timestamp === "number" ? timestamp : Math.floor(Date.parse(candle.time) / 1_000);
}

/**
 * TradingView expects a continuous, ascending bar stream. The indexer only
 * stores intervals with activity, so fill quiet intervals with zero-volume
 * candles. Quiet candles carry the previous close instead of inventing a
 * price path between two real trades; the raw market.json data is unchanged.
 */
export function fillCandleGaps(candles: Candle[], interval: MarketInterval) {
  const step = MARKET_INTERVAL_SECONDS[interval];
  const ordered = [...candles]
    .filter((candle) => Number.isFinite(candleTimestamp(candle)))
    .sort((a, b) => candleTimestamp(a) - candleTimestamp(b));
  const deduped = ordered.filter((candle, index) => index === 0 || candleTimestamp(candle) !== candleTimestamp(ordered[index - 1]));
  const filled: Candle[] = [];

  for (const candle of deduped) {
    const previous = filled.at(-1);
    if (previous) {
      const previousTimestamp = candleTimestamp(previous);
      const currentTimestamp = candleTimestamp(candle);
      for (let timestamp = previousTimestamp + step; timestamp < currentTimestamp; timestamp += step) {
        const open = previous.close;
        filled.push({
          time: new Date(timestamp * 1_000).toISOString(),
          timestamp,
          open,
          high: open,
          low: open,
          close: open,
          volume: 0,
        });
      }
    }
    // 连续行情展示：新周期从上一周期收盘价开始。保留真实价格极值、
    // 收盘价和成交量；仅调整展示 OHLC，不修改 market.json 或交易记录。
    const open = previous?.close ?? candle.open;
    filled.push({
      ...candle,
      open,
      high: Math.max(candle.high, candle.open, open, candle.close),
      low: Math.min(candle.low, candle.open, open, candle.close),
    });
  }

  return filled;
}

/** Add the latest reserve-derived price so the chart agrees with the quote card. */
export function addCurrentPriceCandle(candles: Candle[], interval: MarketInterval, price: number, atSeconds: number) {
  if (!Number.isFinite(price) || !Number.isFinite(atSeconds)) return fillCandleGaps(candles, interval);
  const step = MARKET_INTERVAL_SECONDS[interval];
  const bucket = Math.floor(atSeconds / step) * step;
  const ordered = [...candles].sort((a, b) => candleTimestamp(a) - candleTimestamp(b));
  const existing = ordered.find((candle) => candleTimestamp(candle) === bucket);
  const previous = ordered.filter((candle) => candleTimestamp(candle) < bucket).at(-1);

  if (existing) {
    const updated = {
      ...existing,
      high: Math.max(existing.high, price),
      low: Math.min(existing.low, price),
      close: price,
    };
    return fillCandleGaps([...ordered.filter((candle) => candleTimestamp(candle) !== bucket), updated], interval);
  }

  if (previous && bucket > candleTimestamp(previous)) {
    ordered.push({
      time: new Date(bucket * 1_000).toISOString(),
      timestamp: bucket,
      open: previous.close,
      high: Math.max(previous.close, price),
      low: Math.min(previous.close, price),
      close: price,
      volume: 0,
    });
  } else if (ordered.length === 0) {
    ordered.push({
      time: new Date(bucket * 1_000).toISOString(),
      timestamp: bucket,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
    });
  }

  return fillCandleGaps(ordered, interval);
}
