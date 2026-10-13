import { getMarketConfig } from "../lib/market/config.mjs";
import { backupMarketDatabase } from "../lib/market/data-maintenance.mjs";

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--to")) throw new Error("用法：npm run market:backup:prod -- --to /备份目录/market-snapshot.db");
  const file = await backupMarketDatabase(getMarketConfig(), args[1]);
  console.log(`[market] 数据库备份完成（完整性检查通过）：${file}`);
  console.log("[market] 可通过 scp/SFTP 下载这个独立快照；不要只复制运行中的主库文件");
} catch (error) {
  console.error(`[market] 备份失败：${error.message}`);
  process.exitCode = 1;
}
