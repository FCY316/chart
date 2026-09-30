import { compactMarketSnapshot } from "@/lib/market-api";
import { readMarket, marketUnavailable } from "@/lib/market-reader";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Web 只读行情，持久化由单个 Worker 负责，避免并发覆盖。 */
export async function GET(request: Request) {
 const market = await readMarket();
 if (!market) return marketUnavailable();
 return Response.json(new URL(request.url).searchParams.get("full") === "true" ? market : compactMarketSnapshot(market));
}
