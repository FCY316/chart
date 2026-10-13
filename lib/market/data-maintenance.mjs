import fs from "node:fs/promises";
import path from "node:path";
import { backup } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { openMarketDatabase, resolveDataFile } from "./database.mjs";

export const backupSuffix = () => `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;

/** 在线备份 API 生成含已提交 WAL 的独立快照，绝不覆盖已有备份。 */
export async function backupMarketDatabase(config, target = `${resolveDataFile(config)}.backup-${backupSuffix()}.db`) {
  const db = openMarketDatabase(config);
  if (!db) throw new Error("数据库不存在，无法备份");
  const file = path.resolve(target);
  try {
    if (!/\.(db|sqlite|sqlite3)$/i.test(file)) throw new Error("备份文件必须以 .db/.sqlite/.sqlite3 结尾");
    if (!db.prepare("SELECT 1 FROM market_state WHERE id = 1").get()) throw new Error("空数据库不能作为有效行情备份");
    if (file === resolveDataFile(config)) throw new Error("备份路径不能等于正在使用的数据库");
    await fs.mkdir(path.dirname(file), { recursive: true });
    const handle = await fs.open(file, "wx");
    await handle.close();
    try {
      await backup(db, file);
      const copy = openMarketDatabase({ ...config, dataFile: file });
      try {
        if (copy.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("数据库备份完整性检查失败");
      } finally { copy?.close(); }
    } catch (error) {
      // 只清理本次独占创建的失败备份，绝不动源数据库或用户已有文件。
      await fs.unlink(file).catch(() => {});
      throw error;
    }
    return file;
  } finally { db.close(); }
}

