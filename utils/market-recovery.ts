import type { Candle, MarketSnapshot } from "@/lib/market";
import { fetchCandlePage, fetchTransactionPage } from "@/lib/market-client";
import { candleTimestamp, MARKET_INTERVAL_SECONDS, mergeMarketStreamUpdate, type MarketEvent, type MarketInterval, type MarketStreamUpdate } from "@/utils/market";

export const datasetVersion = (market: { history?: { datasetVersion?: string } }) => market.history?.datasetVersion ?? "initial";

export function isOlderMarket(current: MarketSnapshot, incoming: { history?: { revision?: number; lastBlock?: number } }) {
  if (current.history?.revision !== undefined && incoming.history?.revision !== undefined) return incoming.history.revision < current.history.revision;
  return (incoming.history?.lastBlock ?? 0) < (current.history?.lastBlock ?? 0);
}

export function snapshotUpdate(snapshot: MarketSnapshot): MarketStreamUpdate {
  return {
    type: "market:update", metadata: snapshot.metadata, quote: snapshot.quote, metrics: snapshot.metrics,
    pool: { ...snapshot.pool, liquidityQuote: snapshot.pool.liquidityQuote }, candlesByInterval: snapshot.candlesByInterval ?? {},
    history: { ...snapshot.history, events: (snapshot.history?.events ?? []) as MarketEvent[], lastBlock: snapshot.history?.lastBlock ?? snapshot.pool.lastBlock, lastSyncAt: snapshot.metadata.updatedAt },
  };
}

/** 最近 25 条不是完整增量：按累计数量和时间跨度判断是否必须补页。 */
export function needsMarketRecovery(previous: MarketSnapshot, next: MarketStreamUpdate) {
  const after = previous.history?.lastBlock ?? previous.pool.lastBlock;
  const newEvents = next.history.events.filter((event) => (event.blockNumber ?? 0) > after).length;
  const delta = (next.history.totalEvents ?? 0) - (previous.history?.totalEvents ?? 0);
  const seconds = (Date.parse(next.metadata.updatedAt) - Date.parse(previous.metadata.updatedAt)) / 1_000;
  return delta > newEvents || seconds >= 120;
}

/** 固定交易区块上界，逐页补齐断线窗口。所有页同代才提交，失败保留原状态等待重试。 */
export async function recoverMarketGap(previous: MarketSnapshot, update: MarketStreamUpdate, signal: AbortSignal,
  loaders = { candles: fetchCandlePage, transactions: fetchTransactionPage }) {
  const epoch = datasetVersion(update);
  const afterBlock = previous.history?.lastBlock ?? previous.pool.lastBlock;
  const events: MarketEvent[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page = await loaders.transactions({ afterBlock, throughBlock: update.history.lastBlock, cursor, limit: 200, signal });
    if ((page.datasetVersion ?? "initial") !== epoch) throw new Error("补数据期间历史已校正，正在重新读取行情");
    events.push(...page.items);
    if (!page.page.hasMore) break;
    cursor = page.page.nextCursor;
    if (!cursor || seen.has(cursor)) throw new Error("补交易数据游标未前进");
    seen.add(cursor);
  } while (!signal.aborted);
  const candlesByInterval: Partial<Record<MarketInterval, Candle[]>> = {};
  for (const [raw, step] of Object.entries(MARKET_INTERVAL_SECONDS)) {
    const interval = raw as MarketInterval;
    const from = Math.floor(Date.parse(previous.metadata.updatedAt) / 1_000 / step) * step;
    const end = Math.floor(Date.parse(update.metadata.updatedAt) / 1_000 / step) * step;
    let before = end + step;
    const candles: Candle[] = [];
    while (!signal.aborted) {
      const page = await loaders.candles({ interval, from, before, limit: 1_000, signal });
      if ((page.datasetVersion ?? "initial") !== epoch) throw new Error("补 K 线期间历史已校正，正在重新读取行情");
      // 最新柱由同一报价快照决定，避免并发写入的新收盘价提前混进旧报价。
      candles.push(...page.items.filter((candle) => candleTimestamp(candle) < end));
      if (!page.page.hasMore) break;
      const next = page.page.nextCursor;
      if (next === null || next >= before) throw new Error("补 K 线数据游标未前进");
      before = next;
    }
    const byTime = new Map(candles.map((candle) => [candleTimestamp(candle), candle]));
    for (const candle of update.candlesByInterval[interval] ?? []) byTime.set(candleTimestamp(candle), candle);
    candlesByInterval[interval] = [...byTime.values()].sort((a, b) => candleTimestamp(a) - candleTimestamp(b));
  }
  if (signal.aborted) throw new Error("已取消行情补齐");
  return mergeMarketStreamUpdate(previous, { ...update, candlesByInterval, history: { ...update.history, events: [...events, ...update.history.events] } });
}
