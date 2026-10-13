"use client";

import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TransactionsPanel } from "@/components/market/transactions-panel";
import { PairSummary } from "@/components/market/pair-summary";
import { MarketHeader } from "@/components/market/market-header";
import { useMarketDashboard } from "@/hooks/use-market-dashboard";
import { useAddressConvert } from "@/hooks/use-address-convert";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MarketFreshness } from "@/components/market/market-freshness";
import { ChartPanel } from "@/components/market/chart-panel";
import { MarketWorkspace } from "@/components/market/market-workspace";

/** 首页仅编排行情组件；订阅与分页逻辑位于 hook。 */
export default function Home() {
  const model = useMarketDashboard();
  const { addressType, changeAddressType } = useAddressConvert();
  const { market, streamStatus, error, fetchMarket } = model;

  return (
    <main className="market-app">
      <MarketHeader streamStatus={streamStatus} addressType={addressType} onAddressTypeChange={changeAddressType}
        freshness={<MarketFreshness health={model.health} recovering={model.recovering} />} />

      <div className="page-width page-content">
        {error && <Alert variant="destructive" className="error-banner"><AlertDescription>{error}</AlertDescription><Button variant="ghost" size="sm" onClick={() => void fetchMarket(true)}>重试</Button></Alert>}
        {!market ? (
          <div className="loading-page"><LoaderCircle className="spin" size={26} /><span>正在读取链上行情…</span></div>
        ) : (
          <MarketWorkspace chart={<ChartPanel model={model} />} pair={<PairSummary model={model} />}
            transactions={<TransactionsPanel model={model} addressType={addressType} />}
            footer={<footer className="page-footer"><span>数据源：InterstellarChain RPC</span><span>区块 #{market.history?.lastBlock ?? market.pool.lastBlock}</span></footer>} />
        )}
      </div>
    </main>
  );
}
