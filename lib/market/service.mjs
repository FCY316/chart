import { buildMarketSnapshot } from "./aggregation.mjs";
import { estimatedTimestamp, getMarketConfig, getTimeModel } from "./config.mjs";
import { parsePairLog } from "./events.mjs";
import { createHttpProvider, createWsProvider, getPairLogs, readPairState } from "./providers.mjs";
import { readMarketSnapshot, writeMarketSnapshot } from "./storage.mjs";

async function loadEventsFromChain(provider, config, state, latestBlock, timeModel) {
  // 首次同步不再按天数截断，而是从配置的起始区块扫描全部可用历史。
  const fromBlock = Math.max(0, config.startBlock);
  const logs = await getPairLogs(provider, config, fromBlock, latestBlock);
  return {
    fromBlock,
    toBlock: latestBlock,
    events: logs.map((log) => parsePairLog(log, state, estimatedTimestamp(log.blockNumber, latestBlock, timeModel))).filter(Boolean),
  };
}

/** 首次回溯最近 N 天事件并覆盖写入 market.json。 */
export async function syncMarketSnapshot(config = getMarketConfig()) {
  const provider = createHttpProvider(config);
  try {
    const latestBlock = await provider.getBlockNumber();
    const timeModel = await getTimeModel(provider, latestBlock);
    const state = await readPairState(provider, config, latestBlock);
    const history = await loadEventsFromChain(provider, config, state, latestBlock, timeModel);
    const snapshot = buildMarketSnapshot(state, history.events, config, timeModel.latestTimestamp);
    await writeMarketSnapshot(snapshot, config);
    return { snapshot, fromBlock: history.fromBlock, toBlock: history.toBlock, eventCount: history.events.length };
  } finally {
    await provider.destroy();
  }
}

/**
 * WebSocket 断线自动重连，并用 HTTP 区块检查兜底。
 * 重连后从 JSON 中保存的 lastBlock 补偿读取，避免丢失断线期间的事件。
 */
export async function watchMarket(config = getMarketConfig()) {
  const http = createHttpProvider(config);
  let current = await readMarketSnapshot(config);
  if (!current?.history?.events?.length) {
    ({ snapshot: current } = await syncMarketSnapshot(config));
  }
  let lastBlock = Number(current.history?.lastBlock || current.pool?.lastBlock || 0);
  let busy = false;
  let websocket = null;
  let reconnectTimer = null;
  let pollTimer = null;
  let reconnectAttempt = 0;
  let stopped = false;

  const processBlock = async (latestBlock) => {
    if (busy || latestBlock <= lastBlock) return;
    busy = true;
    try {
      const state = await readPairState(http, config, latestBlock);
      const logs = await getPairLogs(http, config, lastBlock + 1, latestBlock);
      const timeModel = await getTimeModel(http, latestBlock);
      const nextEvents = logs
        .map((log) => parsePairLog(log, state, log.blockNumber === latestBlock ? timeModel.latestTimestamp : estimatedTimestamp(log.blockNumber, latestBlock, timeModel)))
        .filter(Boolean);
      const existingEvents = current.history?.events || [];
      const eventMap = new Map(existingEvents.map((event) => [`${event.tx}:${event.logIndex}`, event]));
      for (const event of nextEvents) eventMap.set(`${event.tx}:${event.logIndex}`, event);
      const events = [...eventMap.values()]
        .sort((a, b) => a.timestamp - b.timestamp || a.logIndex - b.logIndex);
      current = buildMarketSnapshot(state, events, config, timeModel.latestTimestamp);
      await writeMarketSnapshot(current, config);
      lastBlock = latestBlock;
      console.log(`[market] block ${latestBlock}, +${nextEvents.length} events, ${events.length} events retained`);
    } catch (error) {
      console.error("[market] update failed", error);
    } finally {
      busy = false;
    }
  };

  const closeSocket = async () => {
    const active = websocket;
    websocket = null;
    if (!active) return;
    active.removeAllListeners();
    try {
      active.websocket.onclose = null;
      active.websocket.onerror = null;
    } catch {
      // WebSocket 已关闭时 getter 会抛错，可以安全忽略。
    }
    try {
      await active.destroy();
    } catch {
      // 连接已经断开时 destroy 失败不影响下一次重连。
    }
  };

  const scheduleReconnect = (reason) => {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(config.reconnectMaxMs, config.reconnectBaseMs * (2 ** reconnectAttempt));
    reconnectAttempt += 1;
    console.error(`[market] WebSocket ${reason}; reconnecting in ${delay}ms`);
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      await connectWebSocket();
    }, delay);
  };

  const connectWebSocket = async () => {
    if (stopped) return;
    try {
      await closeSocket();
      const next = createWsProvider(config);
      websocket = next;
      // ethers v6 不负责自动重连，因此监听底层 WebSocket 的 close/error。
      try {
        next.websocket.onclose = () => scheduleReconnect("closed");
        next.websocket.onerror = () => scheduleReconnect("error");
      } catch {
        // 初始化失败会在下面的 catch 中进入重连流程。
      }
      next.on("error", (error) => scheduleReconnect(`provider error: ${error?.message || "unknown"}`));
      next.on("block", (blockNumber) => {
        reconnectAttempt = 0;
        void processBlock(blockNumber);
      });
      console.log(`[market] WebSocket connected; watching ${config.pairAddress} on ${config.chainName}`);
      await processBlock(await http.getBlockNumber());
    } catch (error) {
      console.error("[market] WebSocket connect failed", error);
      await closeSocket();
      scheduleReconnect("connection failure");
    }
  };

  // WebSocket 可能出现假连接，HTTP 轮询作为兜底。
  pollTimer = setInterval(async () => {
    try {
      await processBlock(await http.getBlockNumber());
    } catch (error) {
      console.error("[market] fallback block check failed", error);
    }
  }, config.pollIntervalMs);

  const stop = async () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pollTimer) clearInterval(pollTimer);
    await closeSocket();
    await http.destroy();
  };

  await connectWebSocket();
  return { stop };
}

/** 手动刷新当前储备，不重新回溯历史事件。 */
export async function getCurrentMarketSnapshot(config = getMarketConfig()) {
  const provider = createHttpProvider(config);
  try {
    const current = await readMarketSnapshot(config);
    const state = await readPairState(provider, config);
    const snapshot = buildMarketSnapshot(state, current?.history?.events || [], config, Math.floor(Date.now() / 1_000));
    // 储备刷新没有扫描日志，不能推进历史断点。
    snapshot.history.lastBlock = current?.history?.lastBlock ?? config.startBlock - 1;
    await writeMarketSnapshot(snapshot, config);
    return snapshot;
  } finally {
    await provider.destroy();
  }
}

export { readMarketSnapshot, writeMarketSnapshot } from "./storage.mjs";
