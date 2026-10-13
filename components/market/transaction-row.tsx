"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { formatEventTime, formatNumber, formatPrice, maskAddress, type MarketEvent } from "@/utils/market";
import { convertAddress, type AddressType } from "@/utils/address";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";

type TransactionRowProps = {
  transaction: MarketEvent;
  explorerUrl: string;
  copiedTarget: string | null;
  addressType: AddressType;
  onCopy: (address: string, target: string) => Promise<void>;
};

const SIDE_LABELS: Record<MarketEvent["side"], string> = {
  Buy: "买入",
  Sell: "卖出",
  Swap: "兑换",
  AddLiquidity: "加池子",
  RemoveLiquidity: "减池子",
};

/** 单笔交易独立成行：成交价与总额分列，复制状态按事件而非钱包区分。 */
export function TransactionRow({ transaction, explorerUrl, copiedTarget, addressType, onCopy }: TransactionRowProps) {
  const isLiquidity = transaction.side === "AddLiquidity" || transaction.side === "RemoveLiquidity";
  const tone = isLiquidity ? "liquidity" : transaction.side === "Buy" ? "buy" : transaction.side === "Sell" ? "sell" : "swap";
  const walletAddress = convertAddress(transaction.wallet, addressType);
  // 包含展示格式，切换格式后不会沿用另一种地址的“复制成功”状态。
  const copyTarget = `transaction-${transaction.tx}-${transaction.logIndex}-${transaction.side}-${addressType}`;
  const isCopied = copiedTarget === copyTarget;
  const fullTime = formatEventTime(transaction.time, true);

  return (
    <TableRow className={`transaction-row transaction-row-${tone}`}>
      <TableCell>
        <span className="transaction-time" title={fullTime}>
          <time dateTime={transaction.time}>
            <span className="transaction-time-desktop">{fullTime}</span>
            <span className="transaction-time-mobile">{formatEventTime(transaction.time)}</span>
          </time>
        </span>
      </TableCell>
      <TableCell className="transaction-type">{SIDE_LABELS[transaction.side]}</TableCell>
      <TableCell className="transaction-numeric transaction-price">
        {isLiquidity ? "—" : formatPrice(transaction.price ?? Number.NaN)}
      </TableCell>
      <TableCell className="transaction-numeric transaction-volume">
        <span>{formatNumber(transaction.baseAmount ?? Number.NaN, 4)} <span className="transaction-unit">HUGE</span></span>
        {isLiquidity && <span>{formatNumber(transaction.quoteAmount ?? Number.NaN, 4)} <span className="transaction-unit">NFX</span></span>}
      </TableCell>
      {/* 流动性不是成交，不填成交价／成交额；两种代币数量都放在数量列。
          Swap 总额直接取链上 quoteAmount，不能用已舍入的显示均价反算。 */}
      <TableCell className="transaction-numeric transaction-total">
        {isLiquidity ? "—" : formatNumber(transaction.quoteAmount ?? Number.NaN, 4)}
      </TableCell>
      <TableCell>
        {transaction.wallet ? (
          <Button variant="ghost" size="sm" className={`transaction-wallet h-auto${isCopied ? " is-copied" : ""}`} onClick={() => void onCopy(walletAddress, copyTarget)} title={walletAddress} aria-label={isCopied ? "地址已复制" : `复制交易者地址 ${walletAddress}`}>
            {maskAddress(walletAddress)}
            {isCopied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          </Button>
        ) : <span className="transaction-unknown">未知</span>}
      </TableCell>
      <TableCell>
        <a className="transaction-hash" href={`${explorerUrl.replace(/\/$/, "")}/tx/${transaction.tx}`} target="_blank" rel="noopener noreferrer" title={transaction.tx} aria-label={`在区块浏览器查看交易 ${transaction.tx}`}>
          {maskAddress(transaction.tx)}<ExternalLink size={12} aria-hidden="true" />
        </a>
      </TableCell>
      <TableCell className="transaction-block">{typeof transaction.blockNumber === "number" && Number.isSafeInteger(transaction.blockNumber) && transaction.blockNumber >= 0 ? transaction.blockNumber : "—"}</TableCell>
    </TableRow>
  );
}
