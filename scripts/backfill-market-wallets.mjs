import { getMarketConfig } from "../lib/market/config.mjs";
import { backfillMarketWallets } from "../lib/market/wallet-backfill.mjs";

try {
  console.log("[market] 补齐交易发起地址：请确认 watcher 已停止；不会删除历史或改变扫块断点");
  const result = await backfillMarketWallets(getMarketConfig(), {
    onBackup: (file) => console.log(`[market] 原始文件备份：${file}`),
    onProgress: ({ completed, total }) => {
      if (completed % 25 === 0 || completed === total) console.log(`[market] transaction.from ${completed}/${total}`);
    },
  });
  console.log(result.changed ? `[market] 完成：补齐 ${result.updatedEvents} 条历史事件；文件 ${result.file}` : "[market] 所有交易地址已补齐，无需修改");
} catch (error) {
  console.error(`[market] 地址补齐失败：${error.message}`);
  process.exitCode = 1;
}
