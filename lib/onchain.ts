import { getMarketConfig, readPairState } from "@/lib/pancakeswap-v2.mjs";

/**
 * 兼容旧代码的实时读取函数。
 * 完整历史同步和事件监听请使用 lib/pancakeswap-v2.mjs；这里仅返回当前储备和价格。
 */
export async function getLiveOnchainQuote() {
  const config = getMarketConfig();
  // 动态 import 避免客户端误打包 ethers 和 Node RPC 依赖。
  const { JsonRpcProvider } = await import("ethers");
  const provider = new JsonRpcProvider(config.rpcUrl, { chainId: config.chainId, name: config.chainName }, { staticNetwork: true });
  try {
    const state = await readPairState(provider, config);
    return {
      priceUsd: null,
      priceNative: state.price,
      priceQuote: state.price,
      lastBlock: state.blockNumber,
      reserves: { base: state.baseReserve, quote: state.quoteReserve },
    };
  } finally {
    await provider.destroy();
  }
}
