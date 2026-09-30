import { pairInterface } from "./contracts.mjs";
import { getArg, isoTime, toNumber } from "./config.mjs";

/** 把 Swap、Mint、Burn、Sync 日志转换成统一的市场事件。 */
export function parsePairLog(log, state, timestamp) {
  let parsed;
  try {
    parsed = pairInterface.parseLog({ topics: log.topics, data: log.data });
  } catch {
    return null;
  }
  if (!parsed) return null;
  const args = parsed.args;
  const token0IsBase = state.displayBaseIndex === 0;
  const amount0In = getArg(args, "amount0In", 1) ?? 0n;
  const amount1In = getArg(args, "amount1In", 2) ?? 0n;
  const amount0Out = getArg(args, "amount0Out", 3) ?? 0n;
  const amount1Out = getArg(args, "amount1Out", 4) ?? 0n;
  const baseAmount = token0IsBase ? (amount0In > 0n ? amount0In : amount0Out) : (amount1In > 0n ? amount1In : amount1Out);
  const quoteAmount = token0IsBase ? (amount1In > 0n ? amount1In : amount1Out) : (amount0In > 0n ? amount0In : amount0Out);
  const baseIn = token0IsBase ? amount0In : amount1In;
  const quoteIn = token0IsBase ? amount1In : amount0In;
  const baseOut = token0IsBase ? amount0Out : amount1Out;
  const quoteOut = token0IsBase ? amount1Out : amount0Out;
  const sender = getArg(args, "sender", 0);
  const recipient = getArg(args, "to", 5);
  const base = toNumber(baseAmount, state.displayBaseToken.decimals);
  const quote = toNumber(quoteAmount, state.displayQuoteToken.decimals);
  const price = base > 0 ? quote / base : 0;

  if (parsed.name === "Swap") {
    if (!base || !quote) return null;
    return {
      kind: "swap",
      side: baseIn > 0n && quoteOut > 0n ? "Sell" : baseOut > 0n && quoteIn > 0n ? "Buy" : "Swap",
      timestamp,
      time: isoTime(timestamp),
      blockNumber: log.blockNumber,
      logIndex: log.index,
      wallet: recipient || sender,
      sender,
      baseAmount: base,
      quoteAmount: quote,
      price,
      tx: log.transactionHash,
    };
  }

  if (parsed.name === "Mint" || parsed.name === "Burn") {
    const amount0 = getArg(args, "amount0", 1) ?? 0n;
    const amount1 = getArg(args, "amount1", 2) ?? 0n;
    const baseRaw = token0IsBase ? amount0 : amount1;
    const quoteRaw = token0IsBase ? amount1 : amount0;
    const base = toNumber(baseRaw, state.displayBaseToken.decimals);
    const quote = toNumber(quoteRaw, state.displayQuoteToken.decimals);
    return {
      kind: parsed.name === "Mint" ? "addLiquidity" : "removeLiquidity",
      side: parsed.name === "Mint" ? "AddLiquidity" : "RemoveLiquidity",
      timestamp,
      time: isoTime(timestamp),
      blockNumber: log.blockNumber,
      logIndex: log.index,
      wallet: getArg(args, "to", 3) || sender,
      sender,
      baseAmount: base,
      quoteAmount: quote,
      price: base > 0 ? quote / base : 0,
      tx: log.transactionHash,
    };
  }

  if (parsed.name === "Sync") {
    return {
      kind: "sync",
      timestamp,
      time: isoTime(timestamp),
      blockNumber: log.blockNumber,
      logIndex: log.index,
      tx: log.transactionHash,
      reserve0: String(getArg(args, "reserve0", 0)),
      reserve1: String(getArg(args, "reserve1", 1)),
    };
  }
  return null;
}
