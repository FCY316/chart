"use client";
import { ChevronDown, LoaderCircle, RefreshCw } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TransactionRow } from "@/components/market/transaction-row";
import type { useMarketDashboard, TransactionFilter } from "@/hooks/use-market-dashboard";
import type { AddressType } from "@/utils/address";

const FILTERS: Array<[TransactionFilter, string]> = [["all", "全部"], ["swaps", "买卖"], ["liquidity", "流动性"]];

/** 表格与加载标记共用一个滚动容器，横向滑动不改变原有触底分页逻辑。 */
export function TransactionsPanel({ model, addressType }: { model: ReturnType<typeof useMarketDashboard>; addressType: AddressType }) {
  const { fetchMarket, refreshing, transactionFilter, setTransactionFilter, setVisibleCount, listRef, visibleTransactions, markAddressCopied, copiedTarget, explorerUrl, visibleCount, transactions, transactionHasMore, loadMoreRef, transactionLoading } = model;
  return (
    <Card className="transactions-card">
      <CardHeader className="section-header">
        <div><div className="section-title"><span className="section-pulse" />交易记录</div><p>实时更新 · 上拉加载更早记录</p></div>
        <Button variant="ghost" size="icon" aria-label="刷新" onClick={() => void fetchMarket(true)} disabled={refreshing}>{refreshing ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}</Button>
      </CardHeader>
      <div className="transaction-filters">
        {FILTERS.map(([key, label]) => <button type="button" key={key} aria-pressed={transactionFilter === key} className={transactionFilter === key ? "active" : ""} onClick={() => { setTransactionFilter(key); setVisibleCount(20); }}>{label}</button>)}
      </div>
      <p className="transaction-scroll-hint">左右滑动查看完整交易信息</p>
      <div className="transaction-list" ref={listRef} tabIndex={0} role="region" aria-label="交易记录，可横向滑动查看全部列">
        <table className="transaction-table" aria-label="链上交易记录">
          <thead>
            <tr>
              <th scope="col">时间</th>
              <th scope="col">类型</th>
              <th scope="col" className="transaction-numeric">成交均价 <span>NFX/HUGE</span></th>
              <th scope="col" className="transaction-numeric" title="买卖显示 HUGE 成交量，流动性显示两种代币的加入或取出数量">成交量 <span>HUGE</span></th>
              <th scope="col" className="transaction-numeric">成交额 <span>NFX</span></th>
              <th scope="col">交易者</th>
            </tr>
          </thead>
          <tbody>
            {visibleTransactions.map((transaction) => (
              <TransactionRow key={`${transaction.tx}-${transaction.logIndex}-${transaction.side}`} transaction={transaction} explorerUrl={explorerUrl} copiedTarget={copiedTarget} addressType={addressType} onCopy={markAddressCopied} />
            ))}
            {visibleTransactions.length === 0 && <tr><td colSpan={6} className="transaction-empty"><span>暂无交易记录</span></td></tr>}
          </tbody>
          {(visibleCount < transactions.length || transactionHasMore) && (
            <tfoot><tr><td colSpan={6}><div ref={loadMoreRef} className="load-more"><span><ChevronDown size={15} />{transactionLoading ? "正在加载更早记录…" : "继续上拉加载"}</span></div></td></tr></tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}
