import { INTERVALS, isoTime, pretty } from "./config.mjs";

function buildCandles(trades, intervalSeconds) {
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
        volume: trade.quoteAmount,
        trades: 1,
      });
      continue;
    }
    current.high = Math.max(current.high, trade.price);
    current.low = Math.min(current.low, trade.price);
    current.close = trade.price;
    current.volume += trade.quoteAmount;
    current.trades += 1;
  }
  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function appendCurrentPrice(candles, intervalSeconds, price, timestamp) {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp)) return candles;
  const bucket = Math.floor(timestamp / intervalSeconds) * intervalSeconds;
  const latest = candles.at(-1);
  if (latest?.timestamp === bucket) {
    latest.high = Math.max(latest.high, price);
    latest.low = Math.min(latest.low, price);
    latest.close = price;
    return candles;
  }
  const open = latest?.close ?? price;
  candles.push({
    time: isoTime(bucket),
    timestamp: bucket,
    open,
    high: Math.max(open, price),
    low: Math.min(open, price),
    close: price,
    volume: 0,
    trades: 0,
  });
  return candles;
}

function calculate24h(trades, currentPrice, now) {
  const start = now - 24 * 60 * 60;
  const recent = trades.filter((trade) => trade.timestamp >= start && trade.timestamp <= now);
  const before = trades.filter((trade) => trade.timestamp < start);
  const reference = before.at(-1)?.price || recent[0]?.price || currentPrice;
  const prices = recent.map((trade) => trade.price).filter(Boolean);
  const volume = recent.reduce((sum, trade) => sum + trade.quoteAmount, 0);
  return {
    change24h: reference > 0 ? ((currentPrice / reference) - 1) * 100 : 0,
    high24h: prices.length ? Math.max(...prices) : currentPrice,
    low24h: prices.length ? Math.min(...prices) : currentPrice,
    volume24h: volume,
    trades24h: recent.length,
    buys24h: recent.filter((trade) => trade.side === "Buy").length,
    sells24h: recent.filter((trade) => trade.side === "Sell").length,
    referencePrice24h: reference,
  };
}

function buildTransactions(events) {
  return events
    .filter((event) => event.kind !== "sync")
    .sort((a, b) => b.timestamp - a.timestamp || b.logIndex - a.logIndex)
    .slice(0, 200);
}

/** 根据当前储备和事件生成前端使用的 market.json 结构。 */
export function buildMarketSnapshot(state, events, config, now = Math.floor(Date.now() / 1_000)) {
  // Backfill prices for older JSON files written before liquidity events carried
  // their reserve ratio. This keeps pool price and candles consistent after a restart.
  const normalizedEvents = events.map((event) => {
    if ((event.kind === "addLiquidity" || event.kind === "removeLiquidity") && (!event.price || event.price <= 0) && event.baseAmount > 0 && event.quoteAmount > 0) {
      return { ...event, price: event.quoteAmount / event.baseAmount };
    }
    return event;
  });
  const trades = normalizedEvents.filter((event) => event.kind === "swap").sort((a, b) => a.timestamp - b.timestamp || a.logIndex - b.logIndex);
  const candleEvents = normalizedEvents
    .filter((event) => event.kind === "swap" || (event.kind === "addLiquidity" || event.kind === "removeLiquidity") && event.price > 0)
    .sort((a, b) => a.timestamp - b.timestamp || a.logIndex - b.logIndex);
  const candlesByInterval = Object.fromEntries(Object.entries(INTERVALS).map(([name, seconds]) => [name, appendCurrentPrice(buildCandles(candleEvents, seconds), seconds, state.price, now)]));
  const stats = calculate24h(trades, state.price, now);
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
      { label: "累计交易", value: `${trades.length}`, detail: `24h：${stats.buys24h} 买入 · ${stats.sells24h} 卖出` },
      { label: "24h 涨跌", value: `${stats.change24h >= 0 ? "+" : ""}${stats.change24h.toFixed(2)}%`, detail: `${pretty(stats.referencePrice24h)} → ${pretty(state.price)}`, tone: stats.change24h >= 0 ? "positive" : "negative" },
    ],
    candles: candlesByInterval["5m"],
    candlesByInterval,
    orderBook: { asks: [], bids: [] },
    pool: {
      name: `${displayBase.symbol} / ${displayQuote.symbol}`,
      fee: config.fee,
      initialPrice: trades[0]?.price || state.price,
      createdAt: trades[0]?.time || metadata.updatedAt,
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
    transactions: buildTransactions(normalizedEvents),
    history: {
      intervalSeconds: INTERVALS,
      events: normalizedEvents,
      lastBlock: state.blockNumber,
      lastSyncAt: metadata.updatedAt,
      historyMode: "all",
      startBlock: config.startBlock,
    },
    source: "interstellarchain-pancake-v2",
    fetchedAt: metadata.updatedAt,
  };
}
