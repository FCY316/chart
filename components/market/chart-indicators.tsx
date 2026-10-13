"use client";

import { SlidersHorizontal } from "lucide-react";
import type { IndicatorGroup, IndicatorState } from "@/utils/tradingview-preferences";
import { INDICATORS, INDICATOR_GROUPS } from "@/utils/tradingview-indicators";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** 小屏也保留常用指标入口，详细参数通过图内原生设置修改。 */
export function ChartIndicators({ state, onToggle, onMore }: {
  state: IndicatorState;
  onToggle: (group: IndicatorGroup) => void;
  onMore: () => void;
}) {
  return <>
    <div className="indicator-toolbar" role="group" aria-label="图表指标">
      <span className="indicator-label">指标</span>
      <div className="indicator-options" role="group" aria-label="常用指标，可横向滑动">
      {INDICATOR_GROUPS.map((group) => <Tooltip key={group}>
        <TooltipTrigger asChild><Toggle size="sm" disabled={state.busy} pressed={state[group]} className={state[group] ? "active" : ""}
          aria-label={group} title={INDICATORS[group].title} onPressedChange={() => onToggle(group)}>{group}</Toggle></TooltipTrigger>
        <TooltipContent>{INDICATORS[group].title}</TooltipContent>
      </Tooltip>)}
      </div>
      <Button variant="ghost" size="sm" disabled={state.busy} onClick={onMore} className="indicator-more"><SlidersHorizontal size={13} />更多</Button>
      <span className="indicator-unit">VOL · NFX</span>
    </div>
    {state.error && <p role="alert" className="indicator-error">{state.error}</p>}
  </>;
}
