"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchMarketSnapshot, fetchTransactionPage, subscribeMarketStream } from "@/lib/market-client";
import type { MarketSnapshot } from "@/lib/market";
import { copyAddress as copyAddressToClipboard, getMarketEvents, getPoolPrice, mergeMarketStreamUpdate, type MarketEvent, type MarketInterval } from "@/utils/market";
export type TransactionFilter = "all" | "swaps" | "liquidity";
type StreamStatus = "connecting" | "connected" | "fallback";
type PoolReserves = { base: number; quote: number; baseSymbol: string; quoteSymbol: string };

const ACTIVE_INTERVAL_STORAGE_KEY = "interstellar-market-active-interval";

function getStoredInterval(): MarketInterval {
  if (typeof window === "undefined") return "5m";
  try {
    const saved = window.localStorage.getItem(ACTIVE_INTERVAL_STORAGE_KEY);
    return saved === "1m" || saved === "5m" || saved === "15m" || saved === "1h" || saved === "4h" || saved === "1d" ? saved : "5m";
  } catch {
    return "5m";
  }
}

export const intervals: Array<{ key: MarketInterval; label: string }> = [
  { key: "1m", label: "1m" },
  { key: "5m", label: "5m" },
  { key: "15m", label: "15m" },
  { key: "1h", label: "1H" },
  { key: "4h", label: "4H" },
  { key: "1d", label: "1D" },
];

/** 管理行情订阅、周期偏好和历史分页，展示组件不直接请求网络。 */
export function useMarketDashboard() {
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  // Keep the server and first client render identical; localStorage is read
  // once after hydration to avoid a tab mismatch warning.
  const [activeInterval, setActiveInterval] = useState<MarketInterval>("5m");
  const [intervalHydrated, setIntervalHydrated] = useState(false);
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter>("all");
  const [visibleCount, setVisibleCount] = useState(20);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const [transactionCursorState, setTransactionCursorState] = useState<string | null | undefined>(undefined);
  const [transactionHasMoreState, setTransactionHasMoreState] = useState<boolean | undefined>(undefined);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const transactionRequestRef = useRef(false);
  const snapshotRequestRef = useRef(false);
  const snapshotLoadedRef = useRef(false);
  const failedCursorRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setActiveInterval(getStoredInterval());
      setIntervalHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!intervalHydrated) return;
    try {
      window.localStorage.setItem(ACTIVE_INTERVAL_STORAGE_KEY, activeInterval);
    } catch {
      // Private browsing or embedded WebViews may disable localStorage.
    }
  }, [activeInterval, intervalHydrated]);

  const fetchMarket = useCallback(async (manual = false) => {
    if (snapshotRequestRef.current) return;
    snapshotRequestRef.current = true;
    if (manual) failedCursorRef.current = null;
    if (manual) setRefreshing(true);
    try {
      const next = await fetchMarketSnapshot();
      snapshotLoadedRef.current = true;
      setMarket((current) => {
        if (!current) return next;
        const merged = mergeMarketStreamUpdate(current, {
          type: "market:update", metadata: next.metadata, quote: next.quote,
          pool: { ...next.pool, liquidityQuote: next.pool.liquidityQuote }, candlesByInterval: next.candlesByInterval ?? {},
          history: { events: (next.history?.events ?? []) as MarketEvent[], lastBlock: next.history?.lastBlock ?? next.pool.lastBlock, lastSyncAt: next.metadata.updatedAt },
        });
        return { ...merged, history: { ...merged.history!, totalEvents: next.history?.totalEvents } };
      });
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "行情加载失败");
    } finally {
      snapshotRequestRef.current = false;
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let fallbackTimer: number | undefined;
    const startFallback = () => {
      if (fallbackTimer !== undefined) return;
      void fetchMarket();
      fallbackTimer = window.setInterval(() => void fetchMarket(), 10_000);
    };
    const stopFallback = () => {
      if (fallbackTimer === undefined) return;
      window.clearInterval(fallbackTimer);
      fallbackTimer = undefined;
    };

    // 首次加载显式请求一次普通 JSON 接口，便于在浏览器 Network 中检查；
    // 后续实时更新仍由 SSE 负责，连接失败才会切换为轮询。
    const initialFetchTimer = window.setTimeout(() => void fetchMarket(), 0);
    // 首次同步可能暂时返回 503，即使 SSE 已连上也要定期补取首屏。
    const recoveryTimer = window.setInterval(() => {
      if (!snapshotLoadedRef.current) void fetchMarket();
    }, 10_000);

    const unsubscribe = subscribeMarketStream({
      onOpen: () => {
        setStreamStatus("connected");
        stopFallback();
        // 重连后重新获取快照，弥补连接建立期间的更新。
        void fetchMarket();
      },
      onUpdate: (update) => {
        setMarket((current) => current ? mergeMarketStreamUpdate(current, update) : current);
        setError(null);
      },
      onError: () => {
        setStreamStatus("fallback");
        startFallback();
      },
      onUnsupported: () => {
        setStreamStatus("fallback");
        startFallback();
      },
    });

    return () => {
      window.clearTimeout(initialFetchTimer);
      window.clearInterval(recoveryTimer);
      unsubscribe();
      stopFallback();
    };
  }, [fetchMarket]);

  const transactions = useMemo(() => {
    if (!market) return [];
    const all = getMarketEvents(market);
    if (transactionFilter === "swaps") return all.filter((item) => item.side === "Buy" || item.side === "Sell");
    if (transactionFilter === "liquidity") return all.filter((item) => item.side === "AddLiquidity" || item.side === "RemoveLiquidity");
    return all;
  }, [market, transactionFilter]);

  const visibleTransactions = transactions.slice(0, visibleCount);
  const reserves = (market?.pool.reserves ?? null) as PoolReserves | null;
  const price = market ? getPoolPrice(market) : 0;
  const change = market?.quote.change24h ?? 0;
  const transactionCursor = transactionCursorState === undefined ? market?.history?.transactionsCursor ?? null : transactionCursorState;
  const transactionHasMore = transactionHasMoreState === undefined
    ? Boolean(market && (market.history?.totalEvents ?? transactions.length) > getMarketEvents(market).length)
    : transactionHasMoreState;
  const explorerUrl = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://scan.interstellarchain.org/";

  async function markAddressCopied(address: string, target: string) {
    if (!(await copyAddressToClipboard(address))) return;
    setCopiedTarget(target);
    window.setTimeout(() => setCopiedTarget((current) => current === target ? null : current), 1_500);
  }

  const loadOlderTransactions = useCallback(async () => {
    if (transactionRequestRef.current || transactionLoading || !transactionHasMore || !transactionCursor || failedCursorRef.current === transactionCursor) return;
    transactionRequestRef.current = true;
    setTransactionLoading(true);
    try {
      const payload = await fetchTransactionPage({ limit: 50, cursor: transactionCursor });
      const incoming = payload.items;
      setMarket((current) => {
        if (!current) return current;
        const events = new Map(((current.history?.events ?? []) as MarketEvent[]).map((event) => [`${event.tx}:${event.logIndex ?? ""}`, event]));
        for (const event of incoming) events.set(`${event.tx}:${event.logIndex ?? ""}`, event);
        const mergedEvents = [...events.values()].sort((a, b) => Number(a.blockNumber ?? 0) - Number(b.blockNumber ?? 0) || Number(a.logIndex ?? 0) - Number(b.logIndex ?? 0));
        return {
          ...current,
          history: {
            ...(current.history ?? { lastBlock: current.pool.lastBlock, lastSyncAt: current.metadata.updatedAt }),
            events: mergedEvents,
          },
        };
      });
      setTransactionCursorState(payload.page.nextCursor);
      setTransactionHasMoreState(payload.page.hasMore);
    } catch (loadError) {
      // 停留在底部时失败不得立即无限重试；用户点刷新后恢复。
      failedCursorRef.current = transactionCursor;
      setError(loadError instanceof Error ? loadError.message : "历史交易加载失败");
    } finally {
      transactionRequestRef.current = false;
      setTransactionLoading(false);
    }
  }, [transactionCursor, transactionHasMore, transactionLoading]);

  useEffect(() => {
    const root = listRef.current;
    const sentinel = loadMoreRef.current;
    if (!root || !sentinel) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      if (visibleCount < transactions.length) {
        setVisibleCount((count) => Math.min(count + 20, transactions.length));
      } else {
        void loadOlderTransactions();
      }
    }, { root, rootMargin: "120px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadOlderTransactions, transactionHasMore, transactions.length, visibleCount, refreshing]);

  return { market, activeInterval, setActiveInterval, transactionFilter, setTransactionFilter, visibleCount, setVisibleCount, refreshing, error, copiedTarget, streamStatus, transactionLoading, listRef, loadMoreRef, fetchMarket, transactions, visibleTransactions, reserves, price, change, transactionHasMore, explorerUrl, markAddressCopied };
}
