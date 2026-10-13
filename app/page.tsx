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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MarketFreshness } from "@/components/market/market-freshness";

/** 首页仅编排行情组件；订阅与分页逻辑位于 hook。 */
export default function Home() {
  const model = useMarketDashboard();
  const { addressType, changeAddressType } = useAddressConvert();
  const { market, streamStatus, error, fetchMarket, activeInterval, setActiveInterval, price, explorerUrl } = model;

  return (
    <main className="market-app">
      <MarketHeader streamStatus={streamStatus} addressType={addressType} onAddressTypeChange={changeAddressType} />

      <div className="page-width page-content">
        <MarketFreshness health={model.health} recovering={model.recovering} />
        {error && <Alert variant="destructive" className="error-banner"><AlertDescription>{error}</AlertDescription><Button variant="ghost" size="sm" onClick={() => void fetchMarket(true)}>重试</Button></Alert>}
        {!market ? (
          <div className="loading-page"><LoaderCircle className="spin" size={26} /><span>正在读取链上行情…</span></div>
        ) : (
          <div className="terminal-grid">
            <Card className="chart-card">
              <CardHeader className="chart-card-header flex-row space-y-0">
                <div className="chart-heading"><Activity size={16} /><span>HUGE / NFX</span><span className="chart-unit">NFX</span></div>
                <div className="chart-actions"><Button asChild variant="ghost" size="icon" className="icon-link"><a href={`${explorerUrl.replace(/\/$/, "")}/address/${market.metadata.pairAddress}`} target="_blank" rel="noreferrer" aria-label="查看合约"><ExternalLink size={15} /></a></Button></div>
              </CardHeader>
              <ToggleGroup type="single" size="sm" value={activeInterval} onValueChange={(value) => { const selected = intervals.find((item) => item.key === value); if (selected) setActiveInterval(selected.key); }} className="interval-tabs" aria-label="K线周期">
                {intervals.map((item) => <ToggleGroupItem value={item.key} className={activeInterval === item.key ? "active" : ""} key={item.key}>{item.label}</ToggleGroupItem>)}
              </ToggleGroup>
              <CardContent className="chart-content"><TradingViewChart key={market.history?.datasetVersion ?? "initial"} candlesByInterval={market.candlesByInterval ?? {}} interval={activeInterval} currentPrice={price} updatedAt={market.metadata.updatedAt} chainId={market.metadata.chainId} pairAddress={market.metadata.pairAddress} /></CardContent>
            </Card>
            <aside className="market-sidebar" aria-label="交易对与池子信息"><PairSummary model={model} /></aside>
            <TransactionsPanel model={model} addressType={addressType} />
            <footer className="page-footer"><span>数据源：InterstellarChain RPC</span><span>区块 #{market.history?.lastBlock ?? market.pool.lastBlock}</span></footer>
          </div>
        )}
      </div>
    </main>
  );
}
