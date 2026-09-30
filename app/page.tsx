"use client";

import { Activity, ExternalLink, LoaderCircle } from "lucide-react";
import { TradingViewChart } from "@/components/tradingview-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TransactionsPanel } from "@/components/market/transactions-panel";
import { PairSummary } from "@/components/market/pair-summary";
import { MarketHeader } from "@/components/market/market-header";
import { useMarketDashboard, intervals } from "@/hooks/use-market-dashboard";
import { useAddressConvert } from "@/hooks/use-address-convert";

/** 首页仅编排行情组件；订阅与分页逻辑位于 hook。 */
export default function Home() {
  const model = useMarketDashboard();
  const { addressType, changeAddressType } = useAddressConvert();
  const { market, streamStatus, error, fetchMarket, activeInterval, setActiveInterval, price, explorerUrl } = model;

  return (
    <main className="market-app">
      <MarketHeader streamStatus={streamStatus} addressType={addressType} onAddressTypeChange={changeAddressType} />

      <div className="page-width page-content">
        {error && <div className="error-banner">{error}<Button variant="ghost" size="sm" onClick={() => void fetchMarket(true)}>重试</Button></div>}
        {!market ? (
          <div className="loading-page"><LoaderCircle className="spin" size={26} /><span>正在读取链上行情…</span></div>
        ) : (
          <>
            <Card className="chart-card">
              <CardHeader className="chart-card-header">
                <div className="chart-heading"><Activity size={16} /><span>HUGE / NFX</span><span className="chart-unit">NFX</span></div>
                <div className="chart-actions"><a className="icon-link" href={`${explorerUrl.replace(/\/$/, "")}/address/${market.metadata.pairAddress}`} target="_blank" rel="noreferrer" aria-label="查看合约"><ExternalLink size={15} /></a></div>
              </CardHeader>
              <div className="interval-tabs" role="tablist" aria-label="K线周期">
                {intervals.map((item) => <button type="button" role="tab" aria-selected={activeInterval === item.key} className={activeInterval === item.key ? "active" : ""} key={item.key} onClick={() => setActiveInterval(item.key)}>{item.label}</button>)}
              </div>
              <CardContent className="chart-content"><TradingViewChart candlesByInterval={market.candlesByInterval ?? {}} interval={activeInterval} currentPrice={price} updatedAt={market.metadata.updatedAt} /></CardContent>
            </Card>
            <PairSummary model={model} />
            <TransactionsPanel model={model} addressType={addressType} />
            <footer className="page-footer"><span>数据源：InterstellarChain RPC</span><span>区块 #{market.history?.lastBlock ?? market.pool.lastBlock}</span></footer>
          </>
        )}
      </div>
    </main>
  );
}
