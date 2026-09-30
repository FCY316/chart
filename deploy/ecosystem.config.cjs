// 在项目目录执行：pm2 start deploy/ecosystem.config.cjs
// 单个行情 Worker 写 JSON，Web 进程只读；两者必须使用相同持久目录。
// PM2 使用 CommonJS 加载 .cjs 配置。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");
const cwd = path.resolve(__dirname, "..");
module.exports = {
  apps: [
    {
      name: "chart-web",
      cwd,
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3000",
      env: { NODE_ENV: "production" },
      instances: 1,
      autorestart: true,
    },
    {
      name: "chart-watch",
      cwd,
      script: "scripts/watch-market.mjs",
      node_args: "--env-file=.env.production",
      env: { NODE_ENV: "production" },
      instances: 1,
      // Watcher 维护一个 WebSocket 和单一 JSON 写入者，不能使用 cluster。
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 5000,
      kill_timeout: 30000,
    },
  ],
};
