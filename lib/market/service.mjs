import { getMarketConfig } from "./config.mjs";
import { createHttpProvider, createWsProvider, readPairState } from "./providers.mjs";
import { readMarketSnapshot, readMarketCheckpoint } from "./repository.mjs";
import { appendMarketBatch, hasPendingMarketWallets } from "./indexer-store.mjs";
import { indexMarketRange } from "./indexer.mjs";
import { acquireMarketWriterLock, withMarketWriterLock } from "./writer-lock.mjs";
import { ensureCandleVolumes } from "./volume-maintenance.mjs";
import { ensureExactTimestamps } from "./chain-integrity.mjs";
import { writeWorkerStatus } from "./health.mjs";

async function prepareMarket(config, provider, signal) {
  signal?.throwIfAborted();
  const chainId = Number(BigInt(await provider.send("eth_chainId", [])));
  if (chainId !== config.chainId) throw new Error(`RPC Chain ID ${chainId} 与配置 ${config.chainId} 不符，拒绝写入`);
  signal?.throwIfAborted();
  const result = await ensureCandleVolumes(config);
  if (result.changed) console.log(`[market] 已修复 ${result.candles} 根 K 线的买卖成交量；原库备份：${result.backup}`);
  const times = await ensureExactTimestamps(provider, config, { signal, onProgress: (message) => console.log(`[market] ${message}`) });
  if (times.changed) console.log(`[market] 历史真实时间校正完成：${times.blocks} 个活动区块，无需重新扫全部区块`);
}

/** 首次从配置起点扫，有库则从断点继续；不清空、不全量重建已有历史。 */
export async function syncMarketSnapshot(config = getMarketConfig(), { signal } = {}) {
  return withMarketWriterLock(config, "sync", () => syncMarketSnapshotUnlocked(config, signal));
}

async function syncMarketSnapshotUnlocked(config, signal) {
  const provider = createHttpProvider(config);
  try {
    await prepareMarket(config, provider, signal);
    const result = await indexMarketRange(provider, config, { signal, onBatch: logBatch });
    return { ...result, snapshot: await readMarketSnapshot(config) };
  } catch (error) {
    await writeWorkerStatus(config, { error: true }).catch(() => {});
    throw error;
  } finally {
    await provider.destroy();
  }
}

/**
 * WebSocket 断线自动重连，并用 HTTP 区块检查兜底。
 * 重连后从 SQLite 事务中保存的 lastBlock 补偿读取，避免丢失断线期间的事件。
 */
export async function watchMarket(config = getMarketConfig(), { signal } = {}) {
  const release = await acquireMarketWriterLock(config, "watch");
  let http;
  try {
    http = createHttpProvider(config);
    await prepareMarket(config, http, signal);
    return await startMarketWatcher(config, http, release, signal);
  } catch (error) {
    await writeWorkerStatus(config, { error: true }).catch(() => {});
    try { await http?.destroy(); } finally { await release(); }
    throw error;
  }
}

async function startMarketWatcher(config, http, release, externalSignal) {
  const controller = new AbortController();
  const signal = externalSignal ? AbortSignal.any([externalSignal, controller.signal]) : controller.signal;
  let checkpoint = await readMarketCheckpoint(config);
  if (!checkpoint) {
    await indexMarketRange(http, config, { signal, onBatch: logBatch });
    checkpoint = await readMarketCheckpoint(config);
  }
  if (checkpoint && await hasPendingMarketWallets(config)) {
    console.warn("[market] 旧历史交易地址尚未补齐；请停止 watcher 后运行对应环境的 market:wallets 命令");
  }
  let busy = false;
  let websocket = null;
  let reconnectTimer = null;
  let pollTimer = null;
  let reconnectAttempt = 0;
  let stopped = false;
  let pendingBlock = Promise.resolve();
  let pendingPoll = null;

  const processBlock = (latestBlock) => {
    if (stopped || busy) return Promise.resolve();
    busy = true;
    pendingBlock = (async () => {
      try {
        await indexMarketRange(http, config, { signal, latestBlock, shouldStop: () => stopped, onBatch: (result) => {
          logBatch(result);
        } });
      } catch (error) {
        if (signal.aborted) return; // 正常停止不是扫描故障，由 stop 写停止状态。
        await writeWorkerStatus(config, { error: true }).catch(() => {});
        console.error("[market] update failed", error);
      } finally {
        busy = false;
      }
    })();
    return pendingBlock;
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
      if (stopped) return;
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
  pollTimer = setInterval(() => {
    if (stopped || pendingPoll) return;
    pendingPoll = (async () => {
      try {
        await processBlock(await http.getBlockNumber());
      } catch (error) {
        if (!stopped) {
          await writeWorkerStatus(config, { error: true }).catch(() => {});
          console.error("[market] fallback block check failed", error);
        }
      }
    })().finally(() => { pendingPoll = null; });
  }, config.pollIntervalMs);

  const stop = async () => {
    stopped = true;
    controller.abort();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pollTimer) clearInterval(pollTimer);
    // 等当前批次写完才释放锁，防止 PM2 停止期间与历史补齐发生写入竞争。
    await pendingBlock;
    await pendingPoll;
    await writeWorkerStatus(config, { error: true, stoppedAt: new Date().toISOString() }).catch(() => {});
    try {
      await closeSocket();
      await http.destroy();
    } finally {
      await release();
    }
  };

  await connectWebSocket();
  return { stop };
}

/** 手动刷新当前储备，不重新回溯历史事件。 */
export async function getCurrentMarketSnapshot(config = getMarketConfig()) {
  return withMarketWriterLock(config, "reserve-refresh", () => refreshCurrentMarketSnapshot(config));
}

async function refreshCurrentMarketSnapshot(config) {
  const provider = createHttpProvider(config);
  try {
    await prepareMarket(config, provider);
    const state = await readPairState(provider, config);
    // 储备刷新没有扫描日志，不能推进历史断点。
    await appendMarketBatch(state, [], config, Math.floor(Date.now() / 1_000), { advanceCheckpoint: false });
    return readMarketSnapshot(config);
  } finally {
    await provider.destroy();
  }
}

function logBatch({ lastBlock, addedEvents, totalEvents }) {
  console.log(`[market] block ${lastBlock}, +${addedEvents} events, ${totalEvents} events retained (SQLite)`);
}
