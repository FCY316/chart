import { getMarketConfig } from "@/lib/market/config.mjs";
import { readMarketHealth } from "@/lib/market/health.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 正常追块不当作接口失败；strict=1 可用于要求完全追平的就绪检查。 */
export async function GET(request: Request) {
  try {
    const health = await readMarketHealth(getMarketConfig());
    const strict = new URL(request.url).searchParams.get("strict") === "1";
    const available = health.status === "healthy" || (!strict && health.status === "catching_up");
    // 保留真实 catching_up/落后块数，不把 200 等同于已经追平。
    return Response.json(health, { status: available ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unready", reason: "行情数据库暂不可读", serverTime: new Date().toISOString() }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
