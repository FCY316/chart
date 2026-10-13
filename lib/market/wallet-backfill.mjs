import { createHttpProvider } from "./providers.mjs";
import { resolveDataFile } from "./database.mjs";
import { backupMarketDatabase } from "./data-maintenance.mjs";
import { readWalletCandidates, updateMarketWallets } from "./indexer-store.mjs";
import { resolveEventWallets } from "./wallets.mjs";
import { withMarketWriterLock } from "./writer-lock.mjs";

/** 离线补齐现有 tx 的 from，不扫区块、不重建 K 线、不改变 lastBlock。 */
export async function backfillMarketWallets(config, { createProvider = createHttpProvider, onProgress, onBackup = () => {} } = {}) {
  return withMarketWriterLock(config, "wallet-backfill", async () => {
    const file = resolveDataFile(config);
    const pending = await readWalletCandidates(config);
    if (!pending) throw new Error("数据库不存在，请先导入或同步");
    if (!pending.events.length) return { changed: false, updatedEvents: 0, backupFile: null, file };
    const backupFile = await backupMarketDatabase(config);
    onBackup(backupFile);
    const provider = createProvider(config);
    let resolved;
    try {
      resolved = await resolveEventWallets(provider, pending.events, { onProgress });
    } finally {
      await provider.destroy();
    }
    await updateMarketWallets(config, resolved, pending.revision);
    return { changed: true, updatedEvents: resolved.length, backupFile, file };
  });
}
