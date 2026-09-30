// 兼容入口：业务代码按职责拆分在 lib/market/ 下，旧导入路径继续可用。
export { PANCAKE_V2_PAIR_ABI, ERC20_ABI } from "./market/contracts.mjs";
export { getMarketConfig } from "./market/config.mjs";
export { readPairState, createHttpProvider, createWsProvider } from "./market/providers.mjs";
export { buildMarketSnapshot } from "./market/aggregation.mjs";
export {
  syncMarketSnapshot,
  watchMarket,
  getCurrentMarketSnapshot,
  readMarketSnapshot,
  writeMarketSnapshot,
} from "./market/service.mjs";
