import { formatUnits, isAddress } from "ethers";

export const INTERVALS = {
  "1m": 60,
  "5m": 5 * 60,
  "15m": 15 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60,
};

const DEFAULT_CONFIG = {
  chainId: 1677,
  chainName: "InterstellarChain",
  rpcUrl: "https://rpc.interstellarchain.org/",
  wsUrl: "wss://rpc.interstellarchain.org",
  pairAddress: "0xe51a1b18727c17e01ccd87008255d8a7abf4a006",
  baseTokenAddress: "0x8AF5Da3DEA6eFe400Ddab5baE395eE3c818d325A", // NFX
  quoteTokenAddress: "0xA7eAA7BB5284D37bf24FB91077Fa040f01B0C703", // WHUGE
  quoteDisplaySymbol: "HUGE",
  // 用户确认该池首次活动区块为 219335。
  startBlock: 219_335,
  logChunkSize: 2_000,
  reconnectBaseMs: 1_000,
  reconnectMaxMs: 30_000,
  pollIntervalMs: 30_000,
  dataFile: "data/market.json",
  fee: "0.25%",
};

function envNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 从当前环境读取开发、测试或生产配置。 */
export function getMarketConfig(env = process.env) {
  const config = {
    ...DEFAULT_CONFIG,
    chainId: env.MARKET_CHAIN_ID ? envNumber(env.MARKET_CHAIN_ID, DEFAULT_CONFIG.chainId) : DEFAULT_CONFIG.chainId,
    chainName: env.NEXT_PUBLIC_NETWORK_NAME || DEFAULT_CONFIG.chainName,
    rpcUrl: env.EVM_RPC_URL || DEFAULT_CONFIG.rpcUrl,
    wsUrl: env.EVM_WS_URL || env.EVM_WSS_URL || DEFAULT_CONFIG.wsUrl,
    pairAddress: env.DEX_PAIR_ADDRESS || DEFAULT_CONFIG.pairAddress,
    baseTokenAddress: env.BASE_TOKEN_ADDRESS || DEFAULT_CONFIG.baseTokenAddress,
    quoteTokenAddress: env.QUOTE_TOKEN_ADDRESS || DEFAULT_CONFIG.quoteTokenAddress,
    quoteDisplaySymbol: env.QUOTE_DISPLAY_SYMBOL || DEFAULT_CONFIG.quoteDisplaySymbol,
    startBlock: envNumber(env.MARKET_START_BLOCK, DEFAULT_CONFIG.startBlock),
    logChunkSize: envNumber(env.MARKET_LOG_CHUNK_SIZE, DEFAULT_CONFIG.logChunkSize),
    reconnectBaseMs: envNumber(env.MARKET_WS_RECONNECT_BASE_MS, DEFAULT_CONFIG.reconnectBaseMs),
    reconnectMaxMs: envNumber(env.MARKET_WS_RECONNECT_MAX_MS, DEFAULT_CONFIG.reconnectMaxMs),
    pollIntervalMs: envNumber(env.MARKET_POLL_INTERVAL_MS, DEFAULT_CONFIG.pollIntervalMs),
    dataFile: env.MARKET_DATA_FILE || DEFAULT_CONFIG.dataFile,
    fee: env.DEX_FEE || DEFAULT_CONFIG.fee,
    explorerUrl: env.NEXT_PUBLIC_EXPLORER_URL || "https://scan.interstellarchain.org/",
  };

  for (const [name, address] of Object.entries({
    DEX_PAIR_ADDRESS: config.pairAddress,
    BASE_TOKEN_ADDRESS: config.baseTokenAddress,
    QUOTE_TOKEN_ADDRESS: config.quoteTokenAddress,
  })) {
    if (!isAddress(address)) throw new Error(`${name} 不是有效的 EVM 地址: ${address}`);
  }
  return config;
}

export function lower(address) {
  return String(address).toLowerCase();
}

/** ethers Result 访问不存在的下标时会抛错，事件参数数量不同所以必须安全读取。 */
export function getArg(args, name, index) {
  try {
    return args?.[name] ?? args?.[index];
  } catch {
    return undefined;
  }
}

export function toNumber(value, decimals) {
  const number = Number(formatUnits(value, decimals));
  return Number.isFinite(number) ? number : 0;
}

export function pretty(value, maximumFractionDigits = 4) {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("en-US", { maximumFractionDigits });
}

export function isoTime(unixSeconds) {
  return new Date(unixSeconds * 1_000).toISOString();
}

export async function getTimeModel(provider, latestBlock) {
  const latest = await provider.getBlock(latestBlock);
  if (!latest?.timestamp) return { latestTimestamp: Math.floor(Date.now() / 1_000), secondsPerBlock: 2 };
  const sampleBlock = Math.max(0, latestBlock - 1_000);
  const sample = sampleBlock === latestBlock ? null : await provider.getBlock(sampleBlock).catch(() => null);
  const secondsPerBlock = sample?.timestamp && latestBlock > sampleBlock
    ? Math.max(0.1, (latest.timestamp - sample.timestamp) / (latestBlock - sampleBlock))
    : 2;
  return { latestTimestamp: latest.timestamp, secondsPerBlock };
}

export function estimatedTimestamp(blockNumber, latestBlock, timeModel) {
  return Math.max(0, Math.round(timeModel.latestTimestamp - (latestBlock - blockNumber) * timeModel.secondsPerBlock));
}
