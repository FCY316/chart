import { getMarketConfig, watchMarket } from "../lib/pancakeswap-v2.mjs";

const config = getMarketConfig();
const watcher = await watchMarket(config);

// 进程管理器重启时主动释放 WebSocket 和轮询定时器。
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await watcher.stop();
    process.exit(0);
  });
}

// 保持 Node 进程运行，让 WebSocket 自动重连和 HTTP 兜底检查继续工作。
await new Promise(() => {});
