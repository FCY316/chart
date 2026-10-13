import { toNumber } from "./config.mjs";
import { parsePairLog } from "./events.mjs";
import { getPairLogs, readPairState } from "./providers.mjs";
import { resolveEventWallets } from "./wallets.mjs";
import { readMarketCheckpoint } from "./repository.mjs";
import { appendMarketBatch } from "./indexer-store.mjs";
import { readChainBlock, readEventBlocks, reconcileChain } from "./chain-integrity.mjs";
import { writeWorkerStatus } from "./health.mjs";

/** 首次扫描、手动追块、断线补块共用；每一小批落盘后再推进下一批。 */
export async function indexMarketRange(provider, config, {
  latestBlock, shouldStop = () => false, onBatch = () => {}, signal,
  loadState = readPairState, loadLogs = getPairLogs,
} = {}) {
  signal?.throwIfAborted();
  const target = latestBlock ?? await provider.getBlockNumber();
  if (!Number.isSafeInteger(target) || target < 0) throw new Error("RPC 返回了无效的最新区块");
  const targetBlock = await readChainBlock(provider, target);
  await writeWorkerStatus(config, { observedBlock: target, chainTime: targetBlock.timestamp, checkedAt: new Date().toISOString(), error: null });
  await reconcileChain(provider, config, target, { signal });
  const checkpoint = await readMarketCheckpoint(config);
  const fromBlock = (checkpoint?.lastBlock ?? config.startBlock - 1) + 1;
  let lastBlock = fromBlock - 1, addedEvents = 0, totalEvents = checkpoint?.events ?? 0;
  if (target < fromBlock) return { fromBlock, toBlock: lastBlock, addedEvents, eventCount: totalEvents };
  // 只在最新目标区块读取代币元数据和当前储备，不要求节点保留旧 eth_call 状态。
  const latestState = await loadState(provider, config, target);
  let reserves = checkpoint?.reserves ?? { base: 0, quote: 0 };
  let previousHash = checkpoint?.blockHash;
  for (let cursor = fromBlock; cursor <= target && !shouldStop(); cursor += config.logChunkSize) {
    const end = Math.min(target, cursor + config.logChunkSize - 1);
    const endBlock = end === target ? targetBlock : await readChainBlock(provider, end);
    const logs = await loadLogs(provider, config, cursor, end, { signal });
    const blocks = await readEventBlocks(provider, logs.map((log) => log.blockNumber), { signal });
    const parsed = logs.map((log) => {
      const block = blocks.get(log.blockNumber);
      if (log.removed || log.blockNumber < cursor || log.blockNumber > end || log.blockHash?.toLowerCase() !== block.hash) throw new Error("日志不属于本批当前主链，拒绝推进断点");
      const event = parsePairLog(log, latestState, block.timestamp);
      return event ? { ...event, blockHash: block.hash } : null;
    }).filter(Boolean);
    // V2 的储备变化都会发出 Sync。每批取最后一个 Sync，无活动批次延续上批储备。
    // 初次从池子首次活动区块之前/当块扫描，第一条 Sync 到来前储备为零。
    const sync = parsed.findLast((event) => event.kind === "sync");
    if (sync) {
      const baseRaw = latestState.displayBaseIndex === 0 ? sync.reserve0 : sync.reserve1;
      const quoteRaw = latestState.displayBaseIndex === 0 ? sync.reserve1 : sync.reserve0;
      reserves = { base: toNumber(baseRaw, latestState.displayBaseToken.decimals), quote: toNumber(quoteRaw, latestState.displayQuoteToken.decimals) };
    }
    // 最后一批再以同一目标区块的链上状态校准现价，历史批次不拿最新价冒充旧价格。
    const state = end === target ? latestState : {
      ...latestState, blockNumber: end,
      displayBaseReserve: reserves.base, displayQuoteReserve: reserves.quote,
      baseReserve: reserves.quote, quoteReserve: reserves.base,
      price: reserves.base > 0 ? reserves.quote / reserves.base : 0,
    };
    const events = await resolveEventWallets(provider, parsed, { signal });
    if ((await readChainBlock(provider, end)).hash !== endBlock.hash) throw new Error("读取日志期间区块哈希改变，请重试");
    if (previousHash && (await readChainBlock(provider, lastBlock)).hash !== previousHash) throw new Error("读取日志期间上一断点发生重组，请重试");
    signal?.throwIfAborted();
    // RPC 完成后才进入短写事务，不能在持锁事务中等待网络。
    const result = await appendMarketBatch(state, events, config, endBlock.timestamp, { fromBlock: cursor, blockHash: endBlock.hash });
    lastBlock = result.lastBlock;
    previousHash = endBlock.hash;
    addedEvents += result.addedEvents;
    totalEvents = result.totalEvents;
    onBatch(result);
  }
  return { fromBlock, toBlock: lastBlock, addedEvents, eventCount: totalEvents };
}
