import { INTERVALS, isoTime, pretty } from "./config.mjs";

export function buildCandles(trades, intervalSeconds) {
  const buckets = new Map();
  for (const trade of trades) {
    if (!trade.price || !trade.timestamp) continue;
    const bucket = Math.floor(trade.timestamp / intervalSeconds) * intervalSeconds;
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, {
        time: isoTime(bucket),
        timestamp: bucket,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        // 流动性事件仍参与价格，但 VOL 只统计买卖的 NFX 成交额。
        volume: trade.kind === "swap" ? trade.quoteAmount : 0,
        trades: trade.kind === "swap" ? 1 : 0,
      });
      continue;
    }
    current.high = Math.max(current.high, trade.price);
    current.low = Math.min(current.low, trade.price);
    current.close = trade.price;
    if (trade.kind === "swap") {
      current.volume += trade.quoteAmount;
      current.trades += 1;
    }
  }
  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/** 小型行情头，不携带全量历史；SQLite 每批次只更新此记录与受影响的数据行。 */
export function buildMarketHeader(state, config, now, stats, totalTrades, firstTrade) {
  const displayBase = state.displayBaseToken;
  const displayQuote = state.displayQuoteToken;
  const liquidityQuote = state.displayQuoteReserve * 2;
  const metadata = {
    productName: `${displayBase.symbol} / ${displayQuote.symbol}`,
    pair: `${displayBase.symbol} / ${displayQuote.symbol}`,
    network: config.chainName,
    chainId: config.chainId,
    pairAddress: config.pairAddress,
    updatedAt: isoTime(now),
    baseToken: displayBase,
    quoteToken: displayQuote,
    priceUnit: displayQuote.symbol,
  };
  return {
    metadata,
    quote: {
      // 当前池子没有 USD 预言机，价格是 1 HUGE 等于多少 NFX。
      priceUsd: null,
      priceNative: state.price,
      priceQuote: state.price,
      priceUnit: displayQuote.symbol,
      change24h: stats.change24h,
      high24h: stats.high24h,
      low24h: stats.low24h,
      volume24h: stats.volume24h,
      marketCap: null,
      fullyDilutedValue: null,
    },
    metrics: [
      { label: "池子储备", value: `${pretty(state.displayBaseReserve)} ${displayBase.symbol}`, detail: `${pretty(state.displayQuoteReserve)} ${displayQuote.symbol}` },
      { label: "24h 成交量", value: `${pretty(stats.volume24h)} ${displayQuote.symbol}`, detail: `${stats.trades24h} 笔交易` },
      { label: "累计交易", value: `${totalTrades}`, detail: `24h：${stats.buys24h} 买入 · ${stats.sells24h} 卖出` },
      { label: "24h 涨跌", value: `${stats.change24h >= 0 ? "+" : ""}${stats.change24h.toFixed(2)}%`, detail: `${pretty(stats.referencePrice24h)} → ${pretty(state.price)}`, tone: stats.change24h >= 0 ? "positive" : "negative" },
    ],
    candles: [],
    candlesByInterval: {},
    orderBook: { asks: [], bids: [] },
    pool: {
      name: `${displayBase.symbol} / ${displayQuote.symbol}`,
      fee: config.fee,
      initialPrice: firstTrade?.price || state.price,
      createdAt: firstTrade?.time || metadata.updatedAt,
      factoryAddress: state.factory,
      lastBlock: state.blockNumber,
      reserves: {
        base: state.displayBaseReserve,
        quote: state.displayQuoteReserve,
        baseSymbol: displayBase.symbol,
        quoteSymbol: displayQuote.symbol,
      },
      liquidityQuote,
    },
    transactions: [],
    history: {
      intervalSeconds: INTERVALS,
      events: [],
      lastBlock: state.blockNumber,
      lastSyncAt: metadata.updatedAt,
      historyMode: "all",
      candleVolumeVersion: 1,
      volumeUnit: displayQuote.symbol,
      startBlock: config.startBlock,
    },
    source: "interstellarchain-pancake-v2",
    fetchedAt: metadata.updatedAt,
  };
}
