import { getMarketConfig } from "../lib/market/config.mjs";
import { syncMarketSnapshot } from "../lib/market/service.mjs";
import { runMarketProcess } from "../lib/market/process-lifecycle.mjs";

const config = getMarketConfig();
const result = await runMarketProcess((signal) => syncMarketSnapshot(config, { signal }));
if (result) console.log(`[market] synced +${result.addedEvents} events from block ${result.fromBlock} to ${result.toBlock}; ${result.eventCount} events retained`);

