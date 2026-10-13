"use client";

import { Activity, ExternalLink } from "lucide-react";
import { TradingViewChart } from "@/components/tradingview-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { intervals, type useMarketDashboard } from "@/hooks/use-market-dashboard";

/** 周期和交易对标题共用一行，减少桌面工具栏占用；原生图表工具保持不变。 */
export function ChartPanel({ model }: { model: ReturnType<typeof useMarketDashboard> }) {
  const { market, activeInterval, setActiveInterval, price, explorerUrl } = model;
  if (!market) return null;
  return <Card className="chart-card">
    <CardHeader className="chart-card-header flex-row space-y-0">
      <div className="chart-heading"><Activity size={16} /><span>HUGE / NFX</span><span className="chart-unit">NFX</span></div>
      <ToggleGroup type="single" size="sm" value={activeInterval} onValueChange={(value) => { const selected = intervals.find((item) => item.key === value); if (selected) setActiveInterval(selected.key); }} className="interval-tabs" aria-label="K线周期">
        {intervals.map((item) => <ToggleGroupItem value={item.key} className={activeInterval === item.key ? "active" : ""} key={item.key}>{item.label}</ToggleGroupItem>)}
      </ToggleGroup>
      <Button asChild variant="ghost" size="icon" className="icon-link"><a href={`${explorerUrl.replace(/\/$/, "")}/address/${market.metadata.pairAddress}`} target="_blank" rel="noreferrer" aria-label="查看合约"><ExternalLink size={15} /></a></Button>
    </CardHeader>
    <CardContent className="chart-content"><TradingViewChart key={market.history?.datasetVersion ?? "initial"} candlesByInterval={market.candlesByInterval ?? {}} interval={activeInterval} currentPrice={price} updatedAt={market.metadata.updatedAt} chainId={market.metadata.chainId} pairAddress={market.metadata.pairAddress} /></CardContent>
  </Card>;
}
