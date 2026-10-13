"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCandlePage } from "@/lib/market-client";
import { loadTradingViewLibrary } from "@/utils/tradingview-loader";
import { Button } from "@/components/ui/button";
import { ChartIndicators } from "@/components/market/chart-indicators";
import { chartLayoutKey, createChartPreferences, EMPTY_INDICATORS, readChartLayout, type PreferenceWidget } from "@/utils/tradingview-preferences";
import type { Candle } from "@/lib/market";
import { addCurrentPriceCandle, candleTimestamp, MARKET_INTERVAL_SECONDS, type MarketInterval } from "@/utils/market";

type TradingViewWidget = Omit<PreferenceWidget, "activeChart"> & {
  remove: () => void;
  onChartReady: (callback: () => void) => void;
  applyOverrides: (overrides: Record<string, unknown>) => void;
  activeChart: () => ReturnType<PreferenceWidget["activeChart"]> & { setResolution: (resolution: string, callback?: () => void) => void };
};
type TradingViewWindow = Window & {
  TradingView?: { widget: new (options: Record<string, unknown>) => TradingViewWidget };
};
type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
type Subscriber = { resolution: string; callback: (bar: Bar) => void; lastBarTime?: number };

const DISPLAY_PRICE_SCALE = 100;
const CHART_APPEARANCE = {
  "paneProperties.background": "#0b1118",
  "paneProperties.backgroundType": "solid",
  "scalesProperties.textColor": "#8290a3",
};

function unixSeconds(value: number) {
  return value > 1_000_000_000_000 ? value / 1_000 : value;
}

const RESOLUTIONS: Record<MarketInterval, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1d": "1D",
};

const RESOLUTION_TO_INTERVAL: Record<string, MarketInterval> = {
  "1": "1m",
  "5": "5m",
  "15": "15m",
  "60": "1h",
  "240": "4h",
  "1D": "1d",
  D: "1d",
  d: "1d",
};

function intervalForResolution(resolution: string): MarketInterval {
  return RESOLUTION_TO_INTERVAL[resolution] ?? RESOLUTION_TO_INTERVAL[resolution.toUpperCase()] ?? "5m";
}

function candleToBar(candle: Candle): Bar {
  return {
    time: candleTimestamp(candle) * 1_000,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };
}

function mergeCandles(existing: Candle[], incoming: Candle[]) {
  const byTimestamp = new Map(existing.map((candle) => [candleTimestamp(candle), candle]));
  for (const candle of incoming) byTimestamp.set(candleTimestamp(candle), candle);
  return [...byTimestamp.values()].sort((a, b) => candleTimestamp(a) - candleTimestamp(b));
}

type TradingViewChartProps = {
  candlesByInterval: Partial<Record<MarketInterval, Candle[]>>;
  interval: MarketInterval;
  currentPrice: number;
  updatedAt: string;
  chainId: number;
  pairAddress: string;
};

export function TradingViewChart({ candlesByInterval, interval, currentPrice, updatedAt, chainId, pairAddress }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<TradingViewWidget | null>(null);
  const candlesRef = useRef(candlesByInterval);
  const subscribersRef = useRef(new Map<string, Subscriber>());
  const intervalRef = useRef(interval);
  const currentPriceRef = useRef(currentPrice);
  const updatedAtRef = useRef(updatedAt);
  const [status, setStatus] = useState("loading");
  const [statusMessage, setStatusMessage] = useState("正在加载 TradingView 脚本…");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const preferencesRef = useRef<ReturnType<typeof createChartPreferences> | null>(null);
  const ignoreSavedLayoutRef = useRef(false);
  const [indicators, setIndicators] = useState(EMPTY_INDICATORS);
  const layoutKey = chartLayoutKey(chainId, pairAddress);

  useEffect(() => {
    intervalRef.current = interval;
  }, [interval]);

  const getBarsForInterval = useCallback((key: MarketInterval) => addCurrentPriceCandle(
    candlesRef.current[key] ?? [],
    key,
    currentPriceRef.current,
    Math.floor(Date.parse(updatedAtRef.current) / 1_000),
  ).map(candleToBar), []);

  useEffect(() => {
    const mergedCandles = { ...candlesRef.current };
    for (const [rawKey, rawIncoming] of Object.entries(candlesByInterval)) {
      const key = rawKey as MarketInterval;
      const incoming = rawIncoming as Candle[] | undefined;
      if (incoming) mergedCandles[key] = mergeCandles(mergedCandles[key] ?? [], incoming);
    }
    candlesRef.current = mergedCandles;
    currentPriceRef.current = currentPrice;
    updatedAtRef.current = updatedAt;
    for (const subscriber of subscribersRef.current.values()) {
      const key = intervalForResolution(subscriber.resolution);
      const bars = getBarsForInterval(key);
      if (bars.length === 0) continue;
      const firstNewBar = subscriber.lastBarTime === undefined
        ? bars.at(-1)
        : bars.find((bar) => bar.time >= subscriber.lastBarTime!);
      if (!firstNewBar) continue;
      for (const bar of bars.slice(bars.indexOf(firstNewBar))) subscriber.callback(bar);
      subscriber.lastBarTime = bars.at(-1)?.time;
    }
  }, [candlesByInterval, currentPrice, updatedAt, getBarsForInterval]);

  useEffect(() => {
    let cancelled = false;
    let chartReady = false;
    let phase = "图表初始化";
    let initializationTimer: number | undefined;
    // 每个 effect 只释放自己创建的资源，旧回调不能清理新挂载的图表。
    let ownedWidget: TradingViewWidget | null = null;
    let ownedPreferences: ReturnType<typeof createChartPreferences> | null = null;
    const requests = new Set<AbortController>();
    const callbacks = new Set<number>();
    // 即使已有缓存，回调也必须在另一个宏任务执行；同步回调可能让图表初始化卡住。
    const defer = (callback: () => void) => {
      const timer = window.setTimeout(() => {
        callbacks.delete(timer);
        if (!cancelled) callback();
      }, 0);
      callbacks.add(timer);
    };
    const fail = (message: string) => {
      if (cancelled) return;
      window.clearTimeout(initializationTimer);
      setStatusMessage(message);
      setStatus("error");
    };
    const requestPage = async (options: Parameters<typeof fetchCandlePage>[0]) => {
      const controller = new AbortController();
      requests.add(controller);
      const timer = window.setTimeout(() => controller.abort(), 25_000);
      try {
        return await fetchCandlePage({ ...options, signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) throw new Error("K 线请求超时，请检查网络后重试");
        throw error;
      } finally {
        window.clearTimeout(timer);
        requests.delete(controller);
      }
    };
    const init = () => {
      if (cancelled || !containerRef.current || widgetRef.current) return;
      const tradingView = (window as unknown as TradingViewWindow).TradingView;
      if (!tradingView) {
        fail("图表脚本无法运行，请重试");
        return;
      }
      setStatus("loading");
      setStatusMessage("正在初始化 TradingView…");
      initializationTimer = window.setTimeout(() => {
        if (!chartReady) fail(`${phase}超时，请重试`);
      }, 45_000);

      const fetchBars = async (key: MarketInterval, from: number, to: number) => {
        // 完整读取当前请求范围，再补平盘柱，不能把分页截断误当成无交易。
        let before = to;
        const incoming: Candle[] = [];
        while (!cancelled) {
          const payload = await requestPage({ interval: key, limit: 1_000, from, before });
          incoming.push(...payload.items);
          if (!payload.page.hasMore) break;
          const cursor = payload.page.nextCursor;
          if (cursor === null || cursor >= before) throw new Error("K线分页游标没有前进");
          before = cursor;
        }
        // 页首需要上一根真实收盘价，以保持分页边界的开盘价一致。
        if (cancelled) return [];
        const predecessor = await requestPage({ interval: key, limit: 1, before: from });
        incoming.push(...predecessor.items);
        candlesRef.current = {
          ...candlesRef.current,
          [key]: mergeCandles(candlesRef.current[key] ?? [], incoming),
        };
        return getBarsForInterval(key).filter((bar) => bar.time / 1_000 >= from && bar.time / 1_000 < to);
      };

      const datafeed = {
        onReady: (callback: (configuration: Record<string, unknown>) => void) => {
          phase = "行情数据初始化";
          defer(() => callback({
            supported_resolutions: Object.values(RESOLUTIONS),
            supports_marks: false,
            supports_timescale_marks: false,
            // We derive bar times from the API. Do not advertise server time
            // unless a getServerTime callback is also provided.
            supports_time: false,
          }));
        },
        searchSymbols: (_input: string, _exchange: string, _symbolType: string, callback: (symbols: unknown[]) => void) => defer(() => callback([])),
        resolveSymbol: (_name: string, callback: (symbol: Record<string, unknown>) => void) => {
          phase = "交易对信息初始化";
          defer(() => callback({
            ticker: "HUGE/NFX",
            name: "HUGE / NFX",
            full_name: "InterstellarChain:HUGE/NFX",
            description: "HUGE / NFX",
            type: "crypto",
            session: "24x7",
            exchange: "InterstellarChain",
            listed_exchange: "InterstellarChain",
            timezone: "Etc/UTC",
            format: "price",
            // Keep the price axis readable: 1 NFX = 2 decimal places.
            pricescale: DISPLAY_PRICE_SCALE,
            minmov: 1,
            has_intraday: true,
            has_daily: true,
            has_weekly_and_monthly: false,
            // 空档和连续开盘价统一由数据源处理。
            has_empty_bars: false,
            supported_resolutions: Object.values(RESOLUTIONS),
            volume_precision: 2,
            data_status: "streaming",
          }));
        },
        getBars: (
          _symbol: Record<string, unknown>,
          resolution: string,
          period: { from: number; to: number; countBack?: number },
          onResult: (bars: Bar[], meta: { noData: boolean }) => void,
          onError: (message: string) => void,
        ) => {
          const key = intervalForResolution(resolution);
          const to = unixSeconds(period.to);
          // 首屏快照只有最近 120 根，不能把部分缓存当完整历史再补假平盘。
          // 尊重 countBack，真实读取完请求窗口后再交给图表/指标。
          const countBack = Math.min(5_000, Math.max(0, period.countBack ?? 0));
          const from = Math.min(unixSeconds(period.from), to - countBack * MARKET_INTERVAL_SECONDS[key]);
          phase = "K 线数据加载";
          void fetchBars(key, from, to)
            .then((bars) => {
              defer(() => onResult(bars, { noData: bars.length === 0 }));
            })
            .catch((error: unknown) => {
              // 请求失败不等于历史结束，也不能用不完整缓存补出假平盘柱。
              if (!cancelled) {
                const message = error instanceof Error ? error.message : "K线加载失败";
                fail(message);
                defer(() => onError(message));
              }
            });
        },
        subscribeBars: (
          _symbol: Record<string, unknown>,
          resolution: string,
          callback: (bar: Bar) => void,
          listenerGuid: string,
        ) => {
          const key = intervalForResolution(resolution);
          const bars = getBarsForInterval(key);
          subscribersRef.current.set(listenerGuid, { resolution, callback, lastBarTime: bars.at(-1)?.time });
        },
        unsubscribeBars: (listenerGuid: string) => {
          subscribersRef.current.delete(listenerGuid);
        },
      };

      const savedLayout = ignoreSavedLayoutRef.current ? undefined : readChartLayout(layoutKey);
      const widget = new tradingView.widget({
        container: containerRef.current,
        library_path: "/charting_library/",
        symbol: "HUGE/NFX",
        interval: RESOLUTIONS[intervalRef.current],
        datafeed,
        locale: "zh",
        timezone: "Asia/Shanghai",
        theme: "dark",
        autosize: true,
        saved_data: savedLayout,
        auto_save_delay: 1,
        enabled_features: [
          "hide_left_toolbar_by_default",
          "save_chart_properties_to_local_storage",
          // 统一使用官方 about:blank 兼容模式，不依赖 UA。
          // iPad 桌面 UA/内嵌浏览器也可能不含 Mobile，却限制 blob iframe。
          "iframe_loading_compatibility_mode",
        ],
        disabled_features: [
          // 纵向触摸交给页面滚动；该开关仅影响触摸，不影响 PC 鼠标拖动。
          // 保留默认的横向拖图和双指缩放，不用遮罩盖住图表。
          "vert_touch_drag_scroll",
          // 显式创建独立 VOL 面板，避免库的自动成交量造成重复或覆盖主图。
          "create_volume_indicator_by_default",
          "create_volume_indicator_by_default_once",
          "volume_force_overlay",
          "header_symbol_search",
          "header_resolutions",
          "timeframes_toolbar",
          "header_compare",
          "header_undo_redo",
          "header_screenshot",
          "header_fullscreen_button",
          "popup_hints",
        ],
        overrides: {
          "paneProperties.legendProperties.showSeriesOHLC": true,
          ...CHART_APPEARANCE,
          "mainSeriesProperties.candleStyle.upColor": "#28c98b",
          "mainSeriesProperties.candleStyle.downColor": "#f26d78",
          "mainSeriesProperties.candleStyle.borderUpColor": "#28c98b",
          "mainSeriesProperties.candleStyle.borderDownColor": "#f26d78",
          "mainSeriesProperties.candleStyle.wickUpColor": "#28c98b",
          "mainSeriesProperties.candleStyle.wickDownColor": "#f26d78",
        },
      });
      ownedWidget = widget;
      widgetRef.current = widget;
      widget.onChartReady(() => {
        if (cancelled) return;
        // 保存布局可能带旧配色；仅覆盖背景和刻度文字，不清除指标和画线。
        widget.applyOverrides(CHART_APPEARANCE);
        chartReady = true;
        window.clearTimeout(initializationTimer);
        setStatus("ready");
        const preferences = createChartPreferences(widget, layoutKey, setIndicators);
        ownedPreferences = preferences;
        preferencesRef.current = preferences;
        void preferences.initialize(Boolean(savedLayout)).catch((error: unknown) => {
          fail(error instanceof Error ? error.message : "图表指标初始化失败，请重试");
        });
      });
    };

    void loadTradingViewLibrary().then(init).catch((error: unknown) => {
      fail(error instanceof Error ? error.message : "图表初始化失败，请重试");
    });

    const subscribers = subscribersRef.current;
    return () => {
      cancelled = true;
      window.clearTimeout(initializationTimer);
      for (const timer of callbacks) window.clearTimeout(timer);
      for (const request of requests) request.abort();
      subscribers.clear();
      const preferences = ownedPreferences, widget = ownedWidget;
      ownedPreferences = null;
      ownedWidget = null;
      if (preferencesRef.current === preferences) preferencesRef.current = null;
      if (widgetRef.current === widget) widgetRef.current = null;
      try { preferences?.dispose(); }
      catch { /* 第三方清理失败不能阻断后续 iframe 销毁。 */ }
      try { widget?.remove(); }
      catch { /* iframe 可能已随 Fast Refresh/父节点卸载而销毁。 */ }
    };
  }, [getBarsForInterval, loadAttempt, layoutKey]);

  useEffect(() => {
    if (status !== "ready" || !widgetRef.current) return;
    widgetRef.current.activeChart().setResolution(RESOLUTIONS[interval]);
  }, [interval, status]);

  return (
    <div className="chart-workspace">
      <ChartIndicators state={status === "ready" ? indicators : { ...indicators, busy: true }} onToggle={(group) => { if (status === "ready") void preferencesRef.current?.toggle(group); }} onMore={() => preferencesRef.current?.more()} />
      <div className="chart-shell">
        <div ref={containerRef} className="tradingview-container" />
        {status === "loading" && <div className="chart-state" role="status">{statusMessage}</div>}
        {status === "error" && <div className="chart-state chart-state-error" role="alert">
          <div className="chart-error-content">
            <span>{statusMessage}</span>
            <Button variant="outline" size="sm" onClick={() => {
              setStatus("loading");
              setStatusMessage("正在加载 TradingView 脚本…");
              setLoadAttempt((attempt) => attempt + 1);
            }}>重新加载图表</Button>
            <Button variant="ghost" size="sm" title="只清除当前池子在本机保存的指标、画线与面板布局，不删除行情"
              onClick={() => {
                // 缓存状态不兼容时提供明确恢复入口，普通重试不会删除用户画线。
                ignoreSavedLayoutRef.current = true;
                try { window.localStorage.removeItem(layoutKey); } catch { /* 当前重试仍忽略保存布局。 */ }
                setIndicators(EMPTY_INDICATORS);
                setStatus("loading");
                setStatusMessage("正在恢复默认图表…");
                setLoadAttempt((attempt) => attempt + 1);
              }}>清除本机图表设置并重试</Button>
          </div>
        </div>}
      </div>
    </div>
  );
}
