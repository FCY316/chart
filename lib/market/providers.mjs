import { Contract, FetchRequest, JsonRpcProvider, WebSocketProvider } from "ethers";
import { ERC20_ABI, EVENT_TOPICS, PANCAKE_V2_PAIR_ABI } from "./contracts.mjs";
import { getArg, getMarketConfig, lower, toNumber } from "./config.mjs";

const metadataCache = new WeakMap();

export function createHttpProvider(config) {
  const request = new FetchRequest(config.rpcUrl);
  request.timeout = 20_000;
  return new JsonRpcProvider(request, { chainId: config.chainId, name: config.chainName }, { staticNetwork: true, cacheTimeout: -1 });
}

export function createWsProvider(config) {
  return new WebSocketProvider(config.wsUrl, { chainId: config.chainId, name: config.chainName });
}

async function readToken(provider, address) {
  const token = new Contract(address, ERC20_ABI, provider);
  const [name, symbol, decimals] = await Promise.all([
    token.name().catch(() => "Unknown Token"),
    token.symbol().catch(() => "TOKEN"),
    // decimals 决定价格/数量，RPC 失败不能猜成 18 后保存错误行情。
    token.decimals(),
  ]);
  if (!Number.isSafeInteger(Number(decimals)) || Number(decimals) < 0 || Number(decimals) > 255) throw new Error(`代币 ${address} 返回了无效 decimals`);
  return { name, symbol, decimals: Number(decimals), address };
}

/** V2 Pair 的代币地址固定；进程内复用元数据，避免每个新区块重复 9 次 RPC。失败不缓存。 */
async function readPairMetadata(provider, pair, address) {
  let entries = metadataCache.get(provider);
  if (!entries) { entries = new Map(); metadataCache.set(provider, entries); }
  const key = lower(address);
  if (!entries.has(key)) {
    const request = (async () => {
      const [token0, token1, factory] = await Promise.all([pair.token0(), pair.token1(), pair.factory()]);
      return { token0, token1, factory, tokens: await Promise.all([readToken(provider, token0), readToken(provider, token1)]) };
    })().catch((error) => { entries.delete(key); throw error; });
    entries.set(key, request);
  }
  return entries.get(key);
}

/** 读取 Pair 储备，并把展示方向固定为 HUGE / NFX。 */
export async function readPairState(provider, config = getMarketConfig(), targetBlock) {
  // 储备与日志固定到同一区块，防止断点越过未扫描日志。
  const blockNumber = targetBlock ?? await provider.getBlockNumber();
  const pair = new Contract(config.pairAddress, PANCAKE_V2_PAIR_ABI, provider);
  const [metadata, reserveData] = await Promise.all([
    readPairMetadata(provider, pair, config.pairAddress),
    pair.getReserves({ blockTag: blockNumber }),
  ]);
  const { token0, token1, factory, tokens } = metadata;
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

async function getLogsRange(provider, filter, fromBlock, toBlock, signal) {
  signal?.throwIfAborted();
  if (fromBlock > toBlock) return [];
  try {
    return await provider.getLogs({ ...filter, fromBlock, toBlock });
  } catch (error) {
    signal?.throwIfAborted();
    // 节点限制 eth_getLogs 范围时二分查询，直到拿到结果。
    // 网络/超时不是范围限制，不能二分成上千个失败请求。
    const detail = `${error?.message ?? ""} ${JSON.stringify(error?.info?.error ?? error?.error ?? {})}`;
    if (fromBlock === toBlock || ["NETWORK_ERROR", "TIMEOUT"].includes(error?.code)
      || !/limit|range|too many|more than|response size|block span/i.test(detail)) throw error;
    const middle = Math.floor((fromBlock + toBlock) / 2);
    // 顺序拆分，避免节点异常时产生指数级并发请求。
    const left = await getLogsRange(provider, filter, fromBlock, middle, signal);
    const right = await getLogsRange(provider, filter, middle + 1, toBlock, signal);
    return [...left, ...right];
  }
}

export async function getPairLogs(provider, config, fromBlock, toBlock, { signal } = {}) {
  const logs = [];
  for (let cursor = fromBlock; cursor <= toBlock; cursor += config.logChunkSize) {
    const end = Math.min(toBlock, cursor + config.logChunkSize - 1);
    const chunk = await getLogsRange(provider, { address: config.pairAddress, topics: [EVENT_TOPICS] }, cursor, end, signal);
    logs.push(...chunk);
  }
  const unique = new Map(logs.map((log) => [`${log.transactionHash}:${log.index}`, log]));
  return [...unique.values()].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
}
