import { Contract, JsonRpcProvider, WebSocketProvider } from "ethers";
import { ERC20_ABI, EVENT_TOPICS, PANCAKE_V2_PAIR_ABI } from "./contracts.mjs";
import { getArg, getMarketConfig, lower, toNumber } from "./config.mjs";

export function createHttpProvider(config) {
  return new JsonRpcProvider(config.rpcUrl, { chainId: config.chainId, name: config.chainName }, { staticNetwork: true });
}

export function createWsProvider(config) {
  return new WebSocketProvider(config.wsUrl, { chainId: config.chainId, name: config.chainName });
}

async function readToken(provider, address) {
  const token = new Contract(address, ERC20_ABI, provider);
  const [name, symbol, decimals] = await Promise.all([
    token.name().catch(() => "Unknown Token"),
    token.symbol().catch(() => "TOKEN"),
    token.decimals().catch(() => 18),
  ]);
  return { name, symbol, decimals: Number(decimals), address };
}

/** 读取 Pair 储备，并把展示方向固定为 HUGE / NFX。 */
export async function readPairState(provider, config = getMarketConfig(), targetBlock) {
  // 储备与日志固定到同一区块，防止断点越过未扫描日志。
  const blockNumber = targetBlock ?? await provider.getBlockNumber();
  const pair = new Contract(config.pairAddress, PANCAKE_V2_PAIR_ABI, provider);
  const [token0, token1, reserveData, factory] = await Promise.all([
    pair.token0(),
    pair.token1(),
    pair.getReserves({ blockTag: blockNumber }),
    pair.factory().catch(() => "0x0000000000000000000000000000000000000000"),
  ]);
  const tokens = await Promise.all([readToken(provider, token0), readToken(provider, token1)]);
  const baseIndex = lower(token0) === lower(config.baseTokenAddress) ? 0 : lower(token1) === lower(config.baseTokenAddress) ? 1 : -1;
  const quoteIndex = lower(token0) === lower(config.quoteTokenAddress) ? 0 : lower(token1) === lower(config.quoteTokenAddress) ? 1 : -1;
  if (baseIndex < 0 || quoteIndex < 0 || baseIndex === quoteIndex) {
    throw new Error(`LP 中的 token0/token1 与 NFX/WHUGE 不匹配: ${token0} / ${token1}`);
  }

  const reserve0 = getArg(reserveData, "reserve0", 0);
  const reserve1 = getArg(reserveData, "reserve1", 1);
  const baseToken = tokens[baseIndex];
  const quoteToken = tokens[quoteIndex];
  const baseReserve = toNumber(baseIndex === 0 ? reserve0 : reserve1, baseToken.decimals);
  const quoteReserve = toNumber(quoteIndex === 0 ? reserve0 : reserve1, quoteToken.decimals);
  // NFX 是计价币，WHUGE 在前端显示为 HUGE，所以价格取 NFX/WHUGE。
  const price = quoteReserve > 0 ? baseReserve / quoteReserve : 0;
  const displayBaseToken = { ...quoteToken, symbol: config.quoteDisplaySymbol, displaySymbol: config.quoteDisplaySymbol, onChainSymbol: quoteToken.symbol };
  const displayQuoteToken = baseToken;
  return {
    blockNumber,
    pairAddress: config.pairAddress,
    token0: tokens[0],
    token1: tokens[1],
    baseToken,
    quoteToken,
    baseIndex,
    quoteIndex,
    baseReserve,
    quoteReserve,
    displayBaseToken,
    displayQuoteToken,
    displayBaseIndex: quoteIndex,
    displayQuoteIndex: baseIndex,
    displayBaseReserve: quoteReserve,
    displayQuoteReserve: baseReserve,
    price,
    factory,
  };
}

async function getLogsRange(provider, filter, fromBlock, toBlock) {
  if (fromBlock > toBlock) return [];
  try {
    return await provider.getLogs({ ...filter, fromBlock, toBlock });
  } catch (error) {
    // 节点限制 eth_getLogs 范围时二分查询，直到拿到结果。
    if (fromBlock === toBlock) throw error;
    const middle = Math.floor((fromBlock + toBlock) / 2);
    // 顺序拆分，避免节点异常时产生指数级并发请求。
    const left = await getLogsRange(provider, filter, fromBlock, middle);
    const right = await getLogsRange(provider, filter, middle + 1, toBlock);
    return [...left, ...right];
  }
}

export async function getPairLogs(provider, config, fromBlock, toBlock) {
  const logs = [];
  for (let cursor = fromBlock; cursor <= toBlock; cursor += config.logChunkSize) {
    const end = Math.min(toBlock, cursor + config.logChunkSize - 1);
    const chunk = await getLogsRange(provider, { address: config.pairAddress, topics: [EVENT_TOPICS] }, cursor, end);
    logs.push(...chunk);
  }
  const unique = new Map(logs.map((log) => [`${log.transactionHash}:${log.index}`, log]));
  return [...unique.values()].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
}
