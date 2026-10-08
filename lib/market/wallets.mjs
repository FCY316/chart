import { setTimeout as delay } from "node:timers/promises";
import { getAddress, isAddress } from "ethers";

export function hasTransactionWallet(event) {
  return event.walletSource === "transaction.from"
    && isAddress(event.transactionFrom)
    && event.wallet?.toLowerCase() === event.transactionFrom.toLowerCase();
}

/** 只查非 Sync 事件的交易；同一 tx 多条日志只请求一次，限制并发避免压垮 RPC。 */
export async function resolveEventWallets(provider, events, { concurrency = 4, attempts = 3, retryDelayMs = 500, onProgress = () => {} } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(attempts) || attempts < 1) throw new Error("地址查询并发数和尝试次数必须是正整数");
  const origins = new Map();
  const pending = new Set();
  for (const event of events) {
    if (event.kind === "sync") continue;
    if (!/^0x[\da-f]{64}$/i.test(event.tx ?? "")) throw new Error("事件缺少有效交易哈希，无法读取发起地址");
    const hash = event.tx.toLowerCase();
    if (hasTransactionWallet(event)) origins.set(hash, getAddress(event.transactionFrom));
    else pending.add(hash);
  }
  const hashes = [...pending].filter((hash) => !origins.has(hash));
  let cursor = 0;
  let completed = 0;
  let failure;

  async function readOrigin(hash) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const transaction = await provider.getTransaction(hash);
        if (!transaction || !isAddress(transaction.from)) throw new Error("RPC 未返回有效的 transaction.from");
        if (transaction.hash?.toLowerCase() !== hash) throw new Error("RPC 返回的交易哈希不匹配");
        return getAddress(transaction.from);
      } catch (error) {
        if (attempt + 1 === attempts) throw new Error(`读取交易发起地址失败 ${hash}: ${error.message}`, { cause: error });
        await delay(retryDelayMs * (attempt + 1));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, hashes.length) }, async () => {
    while (!failure && cursor < hashes.length) {
      const hash = hashes[cursor++];
      try {
        origins.set(hash, await readOrigin(hash));
        onProgress({ completed: ++completed, total: hashes.length });
      } catch (error) {
        failure ??= error;
      }
    }
  }));
  // 查不到地址不能回退到 Router，也不能让监听断点跳过这笔交易。
  if (failure) throw failure;

  return events.map((event) => {
    if (event.kind === "sync" || hasTransactionWallet(event)) return event;
    const from = origins.get(event.tx.toLowerCase());
    return {
      ...event,
      ...(event.wallet ? { legacyWallet: event.wallet } : {}),
      wallet: from,
      transactionFrom: from,
      walletSource: "transaction.from",
    };
  });
}
