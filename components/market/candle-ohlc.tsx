import type { Candle } from "@/lib/market";
import { addCurrentPriceCandle, formatNumber, type MarketInterval } from "@/utils/market";

type CandleOhlcProps = {
  candles: Candle[];
  interval: MarketInterval;
  currentPrice: number;
  updatedAt: string;
};

/** 手机图例默认收起 OHLC；独立展示最新柱，不冒充十字光标选中的历史柱。 */
export function CandleOhlc({ candles, interval, currentPrice, updatedAt }: CandleOhlcProps) {
  // 与 TradingView datafeed 使用同一补柱/储备价格逻辑，避免数值与图中蜡烛不一致。
  const latest = candles.length > 0 ? addCurrentPriceCandle(
    candles, interval, currentPrice, Math.floor(Date.parse(updatedAt) / 1_000),
  ).at(-1) : undefined;
  const fields = [["开", "open"], ["高", "high"], ["低", "low"], ["收", "close"]] as const;

  return (
    <section className="mobile-candle-ohlc" aria-label="最新 K 线开高低收">
      <div className="candle-ohlc-heading">最新 K 线 · {interval}<span>NFX / HUGE</span></div>
      <dl className="candle-ohlc-values">
        {fields.map(([label, field]) => (
          <div key={field}><dt>{label}</dt><dd>{latest ? formatNumber(latest[field], 2) : "—"}</dd></div>
        ))}
      </dl>
    </section>
  );
}
