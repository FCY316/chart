import type { MarketSnapshot } from "@/lib/market";
import { readMarket } from "@/lib/market-reader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function snapshotSignature(market: MarketSnapshot) {
  const reserves = market.pool.reserves;
  return [
    market.history?.lastBlock ?? market.pool.lastBlock,
    market.history?.lastSyncAt ?? "",
    market.metadata.updatedAt,
    market.quote.priceQuote ?? market.quote.priceNative ?? "",
    reserves?.base ?? "",
    reserves?.quote ?? "",
  ].join(":");
}

/**
 * SSE 只发送实时变化，不能重复发送包含全部历史的 market.json。
 * 首次精简快照由 GET /api/market 提供，完整历史通过分页接口获取。
 */
function toStreamUpdate(market: MarketSnapshot) {
  return {
    type: "market:update",
    metadata: { updatedAt: market.metadata.updatedAt },
    quote: market.quote,
    pool: {
      lastBlock: market.pool.lastBlock,
      reserves: market.pool.reserves,
      liquidityQuote: market.pool.liquidityQuote,
    },
    candlesByInterval: Object.fromEntries(
      Object.entries(market.candlesByInterval ?? {}).map(([key, candles]) => [key, candles.slice(-2)]),
    ),
    history: {
      // 最近事件用于在线刷新；完整历史使用交易分页接口。
      events: (market.history?.events ?? []).slice(-25),
      totalEvents: (market.history?.events ?? []).filter((event) => event.kind !== "sync").length,
      lastBlock: market.history?.lastBlock ?? market.pool.lastBlock,
      lastSyncAt: market.history?.lastSyncAt ?? market.metadata.updatedAt,
    },
  };
}

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let dispose = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let reading = false;
      let signature = "";

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(updateTimer);
        clearInterval(heartbeatTimer);
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // The client may have already closed the stream.
        }
      };

      dispose = close;

      const sendLatest = async () => {
        if (closed || reading) return;
        reading = true;
        try {
          const market = await readMarket();
          if (!market || closed) return;
          const nextSignature = snapshotSignature(market);
          if (nextSignature !== signature) {
            signature = nextSignature;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(toStreamUpdate(market))}\n\n`));
          }
        } catch {
          // Keep the stream alive; the next tick retries the JSON read.
        } finally {
          reading = false;
        }
      };

      const updateTimer = setInterval(() => void sendLatest(), 1_000);
      const heartbeatTimer = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15_000);

      request.signal.addEventListener("abort", close, { once: true });
      void sendLatest();
    },
    cancel() {
      dispose();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
