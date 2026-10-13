"use client";

import { useId } from "react";
import { CircleHelp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Radix Portal 避免列表 overflow 裁切；关闭、避碰与焦点恢复由 Popover 统一处理。 */
export function TransactionDirectionHelp() {
  const titleId = useId();
  const descriptionId = useId();

  return <div className="transaction-heading">
    <div className="section-title">
      <span className="section-pulse" />交易记录
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="transaction-help-toggle" aria-label="买卖方向说明"><CircleHelp size={16} aria-hidden="true" /></Button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} collisionPadding={12} className="transaction-direction-note" aria-labelledby={titleId} aria-describedby={descriptionId}>
          <div className="transaction-direction-heading">
            <h3 id={titleId}>买卖方向说明</h3>
            <PopoverClose asChild><Button variant="ghost" size="icon" aria-label="关闭买卖方向说明"><X size={14} aria-hidden="true" /></Button></PopoverClose>
          </div>
          <div id={descriptionId} className="transaction-direction-body">
            <div>本页将 NFX 作为计价币，作用类似交易对中的 USDT（U），买卖方向以 HUGE 为准。</div>
            <div><strong className="direction-buy">买入 HUGE：</strong>付出 NFX，获得 HUGE，相当于卖出 NFX。</div>
            <div><strong className="direction-sell">卖出 HUGE：</strong>付出 HUGE，获得 NFX，相当于买入 NFX。</div>
            <div className="direction-caveat">仅类比计价角色，不代表 NFX 与 USDT 等值或价格稳定；加减池子不属于买卖。</div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
    <p>实时更新 · 上拉加载更早记录</p>
  </div>;
}
