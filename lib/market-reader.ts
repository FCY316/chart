import type { MarketSnapshot } from "@/lib/market";
import { getMarketConfig, readMarketSnapshot } from "@/lib/pancakeswap-v2.mjs";

let pending: Promise<MarketSnapshot | null> | undefined;
let expiresAt = 0;

/** 运行时读取行情，构建不依赖 market.json 是否存在。 */
export async function readMarket(): Promise<MarketSnapshot | null> {
  // 同一 Node 进程内最多每秒解析一次大 JSON，多个 SSE 客户端共用结果。
  if (!pending || Date.now() >= expiresAt) {
    expiresAt = Date.now() + 1_000;
    pending = readMarketSnapshot(getMarketConfig()).catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  }
  return pending!;
}

export function marketUnavailable() {
  return Response.json({ error: "行情尚未就绪，请启动 market:watch 同步" }, { status: 503 });
}
