"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { formatEventTime, formatNumber, formatPrice, maskAddress, type MarketEvent } from "@/utils/market";

type TransactionRowProps = {
  transaction: MarketEvent;
  explorerUrl: string;
  copiedTarget: string | null;
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
export function TransactionRow({ transaction, explorerUrl, copiedTarget, onCopy }: TransactionRowProps) {
  const isLiquidity = transaction.side === "AddLiquidity" || transaction.side === "RemoveLiquidity";
  const tone = isLiquidity ? "liquidity" : transaction.side === "Buy" ? "buy" : transaction.side === "Sell" ? "sell" : "swap";
  const copyTarget = `transaction-${transaction.tx}-${transaction.logIndex}-${transaction.side}`;
  const isCopied = copiedTarget === copyTarget;
  const fullTime = formatEventTime(transaction.time, true);

  return (
    <tr className={`transaction-row transaction-row-${tone}`}>
      <td>
        <a className="transaction-time" href={`${explorerUrl.replace(/\/$/, "")}/tx/${transaction.tx}`} target="_blank" rel="noreferrer" title={fullTime} aria-label={`查看交易详情，时间 ${fullTime}`}>
          <time dateTime={transaction.time}>
            <span className="transaction-time-desktop">{fullTime}</span>
            <span className="transaction-time-mobile">{formatEventTime(transaction.time)}</span>
          </time>
          <ExternalLink size={12} aria-hidden="true" />
        </a>
      </td>
      <td className="transaction-type">{SIDE_LABELS[transaction.side]}</td>
      <td className="transaction-numeric transaction-price">
        {isLiquidity ? "—" : formatPrice(transaction.price ?? Number.NaN)}
      </td>
      <td className="transaction-numeric transaction-volume">
        <span>{formatNumber(transaction.baseAmount ?? Number.NaN, 4)} <span className="transaction-unit">HUGE</span></span>
        {isLiquidity && <span>{formatNumber(transaction.quoteAmount ?? Number.NaN, 4)} <span className="transaction-unit">NFX</span></span>}
      </td>
      {/* 流动性不是成交，不填成交价／成交额；两种代币数量都放在数量列。
          Swap 总额直接取链上 quoteAmount，不能用已舍入的显示均价反算。 */}
      <td className="transaction-numeric transaction-total">
        {isLiquidity ? "—" : formatNumber(transaction.quoteAmount ?? Number.NaN, 4)}
      </td>
      <td>
        {transaction.wallet ? (
          <button type="button" className={`transaction-wallet${isCopied ? " is-copied" : ""}`} onClick={() => void onCopy(transaction.wallet, copyTarget)} title={transaction.wallet} aria-label={isCopied ? "地址已复制" : `复制交易者地址 ${transaction.wallet}`}>
            {maskAddress(transaction.wallet)}
            {isCopied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          </button>
        ) : <span className="transaction-unknown">未知</span>}
      </td>
    </tr>
  );
}
