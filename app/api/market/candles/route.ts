import { readMarket, marketUnavailable } from "@/lib/market-reader";
import { getCandlePage, parseLimit, DEFAULT_CANDLE_LIMIT, MAX_CANDLE_LIMIT } from "@/lib/market-api";


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

  const market = await readMarket();
  if (!market) return marketUnavailable();
  const result = getCandlePage(market, interval, {
    from: seconds(params.get("from")),
    to: seconds(params.get("to")),
    before: seconds(params.get("before")),
    limit: parseLimit(params.get("limit"), DEFAULT_CANDLE_LIMIT, MAX_CANDLE_LIMIT),
  });

  return Response.json({
    ...result,
    updatedAt: market.metadata.updatedAt,
    lastBlock: market.history?.lastBlock ?? market.pool.lastBlock,
  });
}
