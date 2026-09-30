import type { Candle, MarketSnapshot } from "@/lib/market";
import type { MarketEvent, MarketInterval, MarketStreamUpdate } from "@/utils/market";

type PageInfo = {
  limit: number;
  total: number;
  hasMore: boolean;
};

export type CandlePage = {
  interval: MarketInterval;
  items: Candle[];
  page: PageInfo & { nextCursor: number | null };
  updatedAt: string;
  lastBlock: number;
};

export type TransactionPage = {
  items: MarketEvent[];
  page: PageInfo & { nextCursor: string | null };
  updatedAt: string;
  lastBlock: number;
};

type RequestOptions = { signal?: AbortSignal };

async function requestJson<T>(url: string, options: RequestOptions = {}, label = "行情") {
  const response = await fetch(url, { cache: "no-store", signal: options.signal });
  if (!response.ok) throw new Error(`${label}接口错误：${response.status}`);
  return response.json() as Promise<T>;
}

/** 读取前端首屏使用的精简行情快照。 */
export function fetchMarketSnapshot(options: RequestOptions = {}) {
  return requestJson<MarketSnapshot>(`/api/market?ts=${Date.now()}`, options);
}

/** 读取 TradingView 所需的历史 K 线页。 */
export function fetchCandlePage(options: {
  interval: MarketInterval;
  limit?: number;
  from?: number;
  to?: number;
  before?: number;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({
    interval: options.interval,
    limit: String(options.limit ?? 1_000),
  });
  for (const [key, value] of [["from", options.from], ["to", options.to], ["before", options.before]] as const) {
    if (typeof value === "number" && Number.isFinite(value)) params.set(key, String(Math.floor(value)));
  }
  return requestJson<CandlePage>(`/api/market/candles?${params.toString()}`, { signal: options.signal }, "K线");
}

/** 读取交易记录页；cursor 为空时从最新一页开始。 */
export function fetchTransactionPage(options: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {}) {
  const params = new URLSearchParams({ limit: String(options.limit ?? 50) });
  if (options.cursor) params.set("cursor", options.cursor);
  return requestJson<TransactionPage>(`/api/market/transactions?${params.toString()}`, { signal: options.signal }, "交易");
}

export type MarketStreamHandlers = {
  onOpen?: () => void;
  onUpdate: (update: MarketStreamUpdate) => void;
  onError?: () => void;
  onUnsupported?: () => void;
};

/** 订阅行情 SSE。返回取消订阅函数，断线处理由页面决定是否切换轮询。 */
export function subscribeMarketStream(handlers: MarketStreamHandlers) {
  if (typeof EventSource === "undefined") {
    handlers.onUnsupported?.();
    return () => {};
  }

  const source = new EventSource("/api/market/stream");
  source.onopen = () => handlers.onOpen?.();
  source.onmessage = (event) => {
    try {
      const update = JSON.parse(event.data) as MarketStreamUpdate;
      if (update.type === "market:update") handlers.onUpdate(update);
    } catch {
      handlers.onError?.();
    }
  };
  source.onerror = () => handlers.onError?.();
  return () => source.close();
}
