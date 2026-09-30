"use client";
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, Copy, ExternalLink, LoaderCircle, Minus, Plus, RefreshCw } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatEventTime, formatNumber, formatPrice, maskAddress, type MarketEvent } from "@/utils/market";
import type { useMarketDashboard, TransactionFilter } from "@/hooks/use-market-dashboard";
function transactionIcon(transaction: MarketEvent) {
  if (transaction.side === "Buy") return <ArrowDownLeft size={16} />;
  if (transaction.side === "Sell") return <ArrowUpRight size={16} />;
  if (transaction.side === "AddLiquidity") return <Plus size={16} />;
  return <Minus size={16} />;
}

function transactionLabel(side: string) {
  if (side === "Buy") return "买入 HUGE";
  if (side === "Sell") return "卖出 HUGE";
  if (side === "AddLiquidity") return "添加流动性";
  if (side === "RemoveLiquidity") return "移除流动性";
  return "交易";
}

/** 交易筛选、逐行复制状态与触底加载展示。 */
export function TransactionsPanel({ model }: { model: ReturnType<typeof useMarketDashboard> }) {
 const { fetchMarket, refreshing, transactionFilter, setTransactionFilter, setVisibleCount, listRef, visibleTransactions, markAddressCopied, copiedTarget, explorerUrl, visibleCount, transactions, transactionHasMore, loadMoreRef, transactionLoading } = model;
 return (
            <Card className="transactions-card">
              <CardHeader className="section-header">
                <div><div className="section-title"><span className="section-pulse" />交易记录</div><p>实时更新 · 上拉加载更早记录</p></div>
                <Button variant="ghost" size="icon" aria-label="刷新" onClick={() => void fetchMarket(true)} disabled={refreshing}>{refreshing ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}</Button>
              </CardHeader>
              <div className="transaction-filters">
                {([ ["all", "全部"], ["swaps", "买卖"], ["liquidity", "流动性"] ] as Array<[TransactionFilter, string]>).map(([key, label]) => <button type="button" key={key} className={transactionFilter === key ? "active" : ""} onClick={() => { setTransactionFilter(key); setVisibleCount(20); }}>{label}</button>)}
              </div>
              <div className="transaction-list" ref={listRef}>
                {visibleTransactions.map((transaction) => {
                  const isBuy = transaction.side === "Buy";
                  const isLiquidity = transaction.side === "AddLiquidity" || transaction.side === "RemoveLiquidity";
                  return <div className="transaction-row" key={`${transaction.tx}-${transaction.logIndex}-${transaction.side}`}>
                    <span className={`transaction-icon ${isBuy ? "buy" : transaction.side === "Sell" ? "sell" : "liquidity"}`}>{transactionIcon(transaction)}</span>
                    <span className="transaction-main"><strong>{transactionLabel(transaction.side)}</strong>{transaction.wallet ? <button type="button" className="transaction-wallet" onClick={() => void markAddressCopied(transaction.wallet, `transaction-${transaction.tx}-${transaction.logIndex}-${transaction.side}`)}>{maskAddress(transaction.wallet)} {copiedTarget === `transaction-${transaction.tx}-${transaction.logIndex}-${transaction.side}` ? <Check size={11} /> : <Copy size={11} />}</button> : <small>Unknown</small>}</span>
                    <span className="transaction-amount"><strong>{formatNumber(transaction.baseAmount ?? 0, 4)} HUGE</strong><small>{isLiquidity ? `${formatNumber(transaction.quoteAmount ?? 0, 2)} NFX` : `${formatPrice(transaction.price ?? 0)} NFX`}</small></span>
                    <a className="transaction-time" href={`${explorerUrl.replace(/\/$/, "")}/tx/${transaction.tx}`} target="_blank" rel="noreferrer" aria-label="查看交易详情">
                      <span className="transaction-time-desktop">{formatEventTime(transaction.time, true)}</span>
                      <span className="transaction-time-mobile">{formatEventTime(transaction.time)}</span>
                      <ExternalLink size={12} />
                    </a>
                  </div>;
                })}
                {visibleTransactions.length === 0 && <div className="empty-state">暂无交易记录</div>}
                {(visibleCount < transactions.length || transactionHasMore) && <div ref={loadMoreRef} className="load-more"><ChevronDown size={15} />{transactionLoading ? "正在加载更早记录…" : "继续上拉加载"}</div>}
              </div>
            </Card>
 );
}
