import { marketUnavailable } from "@/lib/market-reader";
import { decodeTransactionCursor, parseLimit, DEFAULT_TRANSACTION_LIMIT, MAX_TRANSACTION_LIMIT } from "@/lib/market-api";
import { getMarketConfig } from "@/lib/market/config.mjs";
import { readTransactionPage } from "@/lib/market/repository.mjs";


export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const readBlock = (key: string) => {
    const raw = params.get(key);
    if (raw === null) return undefined;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : NaN;
  };
  const afterBlock = readBlock("afterBlock"), throughBlock = readBlock("throughBlock");
  if (Number.isNaN(afterBlock) || Number.isNaN(throughBlock) || (params.has("cursor") && !decodeTransactionCursor(params.get("cursor")))) {
    return Response.json({ error: "无效交易分页参数" }, { status: 400 });
  }
  const result = await readTransactionPage(
    getMarketConfig(),
    decodeTransactionCursor(params.get("cursor")),
    parseLimit(params.get("limit"), DEFAULT_TRANSACTION_LIMIT, MAX_TRANSACTION_LIMIT),
    { afterBlock, throughBlock },
  );

  if (!result) return marketUnavailable();
  return Response.json(result);
}
