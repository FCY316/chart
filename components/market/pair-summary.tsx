"use client";
import { Check, Copy, Droplets, BarChart3, WalletCards } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatNumber, formatPrice, maskAddress, getMarketEvents } from "@/utils/market";
import type { useMarketDashboard } from "@/hooks/use-market-dashboard";
/** 池子身份、现价和统计卡片。 */
export function PairSummary({ model }: { model: ReturnType<typeof useMarketDashboard> }) {
  const { market, markAddressCopied, copiedTarget, price, change, reserves } = model;

  if (!market) return null;

  return (
    <>
      <section className="pair-hero">
        <div className="pair-heading">
          <div className="token-stack" aria-hidden="true">
            <span className="token-logo token-logo-huge">H</span>
            <span className="token-logo token-logo-nfx">N</span>
          </div>
          <div className="pair-identity">
            <div className="pair-title-row">
              <h1>{market.metadata.pair}</h1>
              <Badge>V2 LP</Badge>
            </div>
            <button
              type="button"
              className="address-button"
              onClick={() => void markAddressCopied(market.metadata.pairAddress, "lp-address")}
              aria-label="复制 LP 地址"
            >
              <span className="address-label">LP 地址</span>
              <span className="address-value">{maskAddress(market.metadata.pairAddress)}</span>
              {copiedTarget === "lp-address" ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
        </div>

        <div className="price-block">
          <div className="price-value">{formatPrice(price)} <span>NFX</span></div>
          <div className={`change-value ${change >= 0 ? "positive" : "negative"}`}>
            {change >= 0 ? "↑" : "↓"} {Math.abs(change).toFixed(2)}% <span>24H</span>
          </div>
        </div>
      </section>

      <section className="stats-grid">
        <Card className="stat-card"><Droplets size={16} /><span className="stat-label">池子储备</span><strong>{formatNumber(reserves?.base ?? 0)} HUGE</strong><small>{formatNumber(reserves?.quote ?? 0)} NFX</small></Card>
        <Card className="stat-card"><BarChart3 size={16} /><span className="stat-label">24H 成交量</span><strong>{formatNumber(market.quote.volume24h ?? 0)} NFX</strong><small>{market.quote.change24h >= 0 ? "较前日上涨" : "较前日下跌"}</small></Card>
        <Card className="stat-card"><WalletCards size={16} /><span className="stat-label">累计交易</span><strong>{formatNumber(market.history?.totalEvents ?? getMarketEvents(market).length, 0)}</strong><small>全部历史</small></Card>
      </section>
    </>
  );
}
