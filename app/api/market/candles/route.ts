import { marketUnavailable } from "@/lib/market-reader";
import { parseLimit, DEFAULT_CANDLE_LIMIT, MAX_CANDLE_LIMIT } from "@/lib/market-api";
import { getMarketConfig } from "@/lib/market/config.mjs";
import { readCandlePage } from "@/lib/market/repository.mjs";


export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const intervals = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

function seconds(value: string | null) {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const interval = params.get("interval") ?? "5m";
  if (!intervals.has(interval)) {
    return Response.json({ error: `不支持的 K 线周期: ${interval}` }, { status: 400 });
  }

  const result = await readCandlePage(getMarketConfig(), interval, {
    from: seconds(params.get("from")),
    to: seconds(params.get("to")),
    before: seconds(params.get("before")),
    limit: parseLimit(params.get("limit"), DEFAULT_CANDLE_LIMIT, MAX_CANDLE_LIMIT),
  });

  if (!result) return marketUnavailable();
  return Response.json(result);
}
