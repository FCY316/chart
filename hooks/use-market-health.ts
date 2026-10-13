"use client";
import { useEffect, useState } from "react";
import { fetchMarketHealth, type MarketHealth } from "@/lib/market-client";

/** 独立于 SSE 检查数据新鲜度，前后台切换立即检查；超时不无限等待。 */
export function useMarketHealth() {
  const [health, setHealth] = useState<MarketHealth | null>(null);
  useEffect(() => {
    let disposed = false;
    let active: AbortController | null = null;
    const check = async () => {
      if (active || disposed) return;
      const controller = new AbortController();
      active = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const next = await fetchMarketHealth(controller.signal);
        if (!disposed) setHealth(next);
      } catch {
        if (!disposed) setHealth((previous) => ({ ...previous, status: "unknown", reason: "无法检查行情新鲜度，请检查网络", serverTime: new Date().toISOString() }));
      } finally { window.clearTimeout(timeout); active = null; }
    };
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    void check();
    const timer = window.setInterval(() => void check(), 15_000);
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; window.clearInterval(timer); active?.abort(); document.removeEventListener("visibilitychange", visible); };
  }, []);
  return health;
}
