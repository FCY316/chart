import { readMarket, marketUnavailable } from "@/lib/market-reader";
import { getTransactionPage, parseLimit, DEFAULT_TRANSACTION_LIMIT, MAX_TRANSACTION_LIMIT } from "@/lib/market-api";


export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const market = await readMarket();
  if (!market) return marketUnavailable();
  const result = getTransactionPage(
    market,
    params.get("cursor"),
    parseLimit(params.get("limit"), DEFAULT_TRANSACTION_LIMIT, MAX_TRANSACTION_LIMIT),
  );

  return Response.json({
    ...result,
    updatedAt: market.metadata.updatedAt,
    lastBlock: market.history?.lastBlock ?? market.pool.lastBlock,
  });
}
