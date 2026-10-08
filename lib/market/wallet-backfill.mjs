import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createHttpProvider } from "./providers.mjs";
import { resolveDataFile, writeMarketSnapshot } from "./storage.mjs";
import { hasTransactionWallet, resolveEventWallets } from "./wallets.mjs";
import { withMarketWriterLock } from "./writer-lock.mjs";

/** 离线补齐现有 tx 的 from，不扫区块、不重建 K 线、不改变 lastBlock。 */
export async function backfillMarketWallets(config, { createProvider = createHttpProvider, onProgress, onBackup = () => {} } = {}) {
  return withMarketWriterLock(config, "wallet-backfill", async () => {
    const file = resolveDataFile(config);
    const original = await fs.readFile(file, "utf8");
    const snapshot = JSON.parse(original);
    if (!Array.isArray(snapshot.history?.events)) throw new Error("文件缺少 history.events，不能安全补齐历史地址");
    const history = snapshot.history.events;
    const transactions = snapshot.transactions ?? [];
    if (!Array.isArray(transactions)) throw new Error("transactions 格式无效");
    const all = [...history, ...transactions];
    const pendingEvents = all.filter((event) => event.kind !== "sync" && !hasTransactionWallet(event));
    if (!pendingEvents.length) return { changed: false, updatedEvents: 0, backupFile: null, file };

    const suffix = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const backupFile = `${file}.wallet-backup-${suffix}.json`;
    // 独占创建精确原始备份，即使 RPC 查询失败也可找回补齐前的完整内容。
    await fs.writeFile(backupFile, original, { flag: "wx" });
    onBackup(backupFile);
    const provider = createProvider(config);
    let resolved;
    try {
      resolved = await resolveEventWallets(provider, all, { onProgress });
    } finally {
      await provider.destroy();
    }
    // 旧版本 watcher 没有单写者锁，额外检查文件变化，避免覆盖它刚写的区块。
    if (await fs.readFile(file, "utf8") !== original) throw new Error("补齐期间 market.json 被其他进程修改；已中止写入，请停止 watcher 后重试");
    const next = {
      ...snapshot,
      history: { ...snapshot.history, events: resolved.slice(0, history.length) },
      transactions: resolved.slice(history.length),
    };
    await writeMarketSnapshot(next, config);
    return { changed: true, updatedEvents: history.filter((event) => event.kind !== "sync" && !hasTransactionWallet(event)).length, backupFile, file };
  });
}
