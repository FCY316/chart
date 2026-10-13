import type { MarketSnapshot } from "@/lib/market";
import { getMarketConfig } from "@/lib/market/config.mjs";
import { readMarketSnapshot } from "@/lib/market/repository.mjs";

let pending: Promise<MarketSnapshot | null> | undefined;
let expiresAt = 0;

/** 首页/SSE 共用有界 SQL 快照，构建不依赖数据文件。显式 full 不进入缓存。 */
export async function readMarket({ full = false } = {}): Promise<MarketSnapshot | null> {
  if (full) return await readMarketSnapshot(getMarketConfig(), { full: true }) as MarketSnapshot | null;
  // 每进程每秒最多查询一次最近 120 根/周期、25 笔交易，不读取完整历史。
  if (!pending || Date.now() >= expiresAt) {
    expiresAt = Date.now() + 1_000;
    pending = (readMarketSnapshot(getMarketConfig()) as Promise<MarketSnapshot | null>).catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  }
  return pending!;
}

export function marketUnavailable() {
  return Response.json({ error: "行情尚未就绪，请启动 market:watch 同步" }, { status: 503 });
}
