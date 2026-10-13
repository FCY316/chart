"use client";
import { CircleHelp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { MarketHealth } from "@/lib/market-client";
import { formatEventTime } from "@/utils/market";

/** SSE 是页面传输状态；此栏展示独立的链/Worker 数据新鲜度。 */
export function MarketFreshness({ health, recovering }: { health: MarketHealth | null; recovering: boolean }) {
  const status = health?.status ?? "unknown";
  const text = recovering ? "正在补齐断线数据" : status === "healthy" ? "行情同步正常" : status === "catching_up" ? "行情追块中" : status === "stale" ? "行情可能已过期" : status === "unready" ? "等待行情同步" : health ? "行情状态未知" : "检查行情状态中";
  return (
    <section className={`market-freshness freshness-${status}`} aria-label="行情新鲜度">
      <Badge variant="outline" role="status">{text}</Badge>
      <span>{health?.indexedBlock != null ? `已同步 #${health.indexedBlock}` : "等待扫描"}</span>
      <Popover>
        <PopoverTrigger asChild><Button variant="ghost" size="icon" aria-label="查看行情新鲜度说明"><CircleHelp size={14} /></Button></PopoverTrigger>
        <PopoverContent className="freshness-detail" align="start" collisionPadding={12}>
          <p>{health?.reason ?? "正在检查后台扫描状态"}</p>
          <p>链上高度：{health?.observedBlock ?? "未知"} · 已同步：{health?.indexedBlock ?? "未知"}</p>
          {health?.lagBlocks != null && <p>落后 {health.lagBlocks} 块</p>}
          <p>最后探测：{health?.checkedAt ? formatEventTime(health.checkedAt, true) : "暂无"}</p>
          <p>SSE 连接成功只代表网页连接正常，不代表后台已追到最新区块。本状态每 15 秒检查一次。</p>
        </PopoverContent>
      </Popover>
      {/* 正常追块不新增说明行，避免链头变化时将整页反复撑高、收起。 */}
      {health && status !== "healthy" && status !== "catching_up" && <span className="freshness-warning">{health.reason}</span>}
    </section>
  );
}
