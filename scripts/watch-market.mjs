import { getMarketConfig } from "../lib/market/config.mjs";
import { watchMarket } from "../lib/market/service.mjs";
import { runMarketProcess } from "../lib/market/process-lifecycle.mjs";

const config = getMarketConfig();
await runMarketProcess((signal) => watchMarket(config, { signal }), { watch: true });
