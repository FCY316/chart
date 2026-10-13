"use client";

import type { CSSProperties, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useChartHeight } from "@/hooks/use-chart-height";
import { MIN_CHART_HEIGHT, MAX_CHART_HEIGHT } from "@/utils/terminal-layout";

type MarketWorkspaceProps = { chart: ReactNode; pair: ReactNode; transactions: ReactNode; footer: ReactNode };

/** 桌面图表/交易在左侧主区内部共同滚动，拉高图表不会压缩交易区。 */
export function MarketWorkspace({ chart, pair, transactions, footer }: MarketWorkspaceProps) {
  const resize = useChartHeight();
  return <div className="terminal-grid">
    {/* 小屏 display:contents 恢复展示顺序；跨断点不替换图表/交易 DOM。 */}
    <div className={`terminal-panels${resize.dragging ? " is-resizing" : ""}`}>
      <div id="market-chart-panel" className="chart-resizable" style={{ "--terminal-chart-height": `${resize.height}px` } as CSSProperties}>{chart}</div>
      <Button type="button" variant="ghost" className="terminal-resize-handle" role="separator" aria-label="调整 K 线高度"
        aria-orientation="horizontal" aria-controls="market-chart-panel" aria-valuemin={MIN_CHART_HEIGHT} aria-valuemax={MAX_CHART_HEIGHT}
        aria-valuenow={resize.height} aria-valuetext={`${resize.height} 像素`}
        title="拖动只调整 K 线高度，不压缩交易记录；方向键微调，双击恢复默认高度"
        onPointerDown={resize.onPointerDown} onKeyDown={resize.onKeyDown} onDoubleClick={resize.reset} />
      {transactions}
    </div>
    <aside className="market-sidebar" aria-label="交易对与池子信息">{pair}</aside>
    {footer}
  </div>;
}
