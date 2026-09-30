import { getMarketConfig, syncMarketSnapshot } from "../lib/pancakeswap-v2.mjs";

const config = getMarketConfig();
const result = await syncMarketSnapshot(config);
console.log(`[market] synced ${result.eventCount} events from block ${result.fromBlock} to ${result.toBlock}`);

