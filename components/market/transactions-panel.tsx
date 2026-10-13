"use client";
import { ChevronDown, LoaderCircle, RefreshCw } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TransactionRow } from "@/components/market/transaction-row";
import { TransactionDirectionHelp } from "@/components/market/transaction-direction-help";
import type { useMarketDashboard, TransactionFilter } from "@/hooks/use-market-dashboard";
import type { AddressType } from "@/utils/address";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const FILTERS: Array<[TransactionFilter, string]> = [["all", "全部"], ["swaps", "买卖"], ["liquidity", "流动性"]];

/** 表格与加载标记共用一个滚动容器，横向滑动不改变原有触底分页逻辑。 */
export function TransactionsPanel({ model, addressType }: { model: ReturnType<typeof useMarketDashboard>; addressType: AddressType }) {
  const { fetchMarket, refreshing, transactionFilter, setTransactionFilter, setVisibleCount, listRef, visibleTransactions, markAddressCopied, copiedTarget, explorerUrl, visibleCount, transactions, transactionHasMore, loadMoreRef, transactionLoading } = model;
  return (
    <Card className="transactions-card">
      <CardHeader className="section-header transaction-section-header flex-row space-y-0">
        <TransactionDirectionHelp />
        <Button variant="ghost" size="icon" aria-label="刷新" onClick={() => void fetchMarket(true)} disabled={refreshing}>{refreshing ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}</Button>
      </CardHeader>
      <Tabs value={transactionFilter} className="transaction-tabs" onValueChange={(value) => {
        const selected = FILTERS.find(([key]) => key === value);
        if (selected) { setTransactionFilter(selected[0]); setVisibleCount(20); }
      }}>
      <TabsList className="transaction-filters" aria-label="交易类型">
        {FILTERS.map(([key, label]) => <TabsTrigger value={key} key={key} className={transactionFilter === key ? "active" : ""}>{label}</TabsTrigger>)}
      </TabsList>
      <TabsContent value={transactionFilter} className="transaction-tab-content">
      <p className="transaction-scroll-hint">左右滑动查看完整交易信息</p>
      <div className="transaction-list" ref={listRef} tabIndex={0} role="region" aria-label="交易记录，可横向滑动查看全部列">
        {/* 表格外层不再创建第二个滚动根，保留原有表头固定和触底分页。 */}
        <Table containerClassName="overflow-visible" className="transaction-table" aria-label="链上交易记录">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">时间</TableHead>
              <TableHead scope="col">类型</TableHead>
              <TableHead scope="col" className="transaction-numeric">成交均价 <span>NFX/HUGE</span></TableHead>
              <TableHead scope="col" className="transaction-numeric" title="买卖显示 HUGE 成交量，流动性显示两种代币的加入或取出数量">成交量 <span>HUGE</span></TableHead>
              <TableHead scope="col" className="transaction-numeric">成交额 <span>NFX</span></TableHead>
              <TableHead scope="col">交易者</TableHead>
              <TableHead scope="col">交易 Hash</TableHead>
              <TableHead scope="col">块高</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleTransactions.map((transaction) => (
              <TransactionRow key={`${transaction.tx}-${transaction.logIndex}-${transaction.side}`} transaction={transaction} explorerUrl={explorerUrl} copiedTarget={copiedTarget} addressType={addressType} onCopy={markAddressCopied} />
            ))}
            {visibleTransactions.length === 0 && <TableRow><TableCell colSpan={8} className="transaction-empty"><span>暂无交易记录</span></TableCell></TableRow>}
          </TableBody>
          {(visibleCount < transactions.length || transactionHasMore) && (
            <TableFooter className="bg-transparent"><TableRow><TableCell colSpan={8}><div ref={loadMoreRef} className="load-more"><span><ChevronDown size={15} />{transactionLoading ? "正在加载更早记录…" : "继续上拉加载"}</span></div></TableCell></TableRow></TableFooter>
          )}
        </Table>
      </div>
      </TabsContent>
      </Tabs>
    </Card>
  );
}
