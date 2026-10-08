# chart

移动端优先的 HUGE / NFX 行情页：TradingView K 线、池子储备、涨跌幅和实时交易列表。
价格为 **1 HUGE 等于多少 NFX**；HUGE 对应链上的 WHUGE。没有 USD 价格，priceUsd 为 null。

## 项目结构与职责

- app/page.tsx：页面布局和组件组合。
- hooks/use-market-dashboard.ts：行情状态、SSE/备用轮询、周期偏好、交易分页。
- components/market/pair-summary.tsx：交易对信息、价格、储备和统计。
- components/market/market-header.tsx：页面顶栏、实时连接状态和地址格式开关。
- components/market/transactions-panel.tsx：交易筛选、六列表格和触底加载。
- components/market/transaction-row.tsx：单笔交易展示、交易详情和逐行复制状态。
- hooks/use-address-convert.ts：交易者地址格式切换和本地偏好保存。
- utils/address.ts：基于 ethers 和 Bech32 的 `0x ↔ hg` 转换、校验和异常回退。
- components/tradingview-chart.tsx：TradingView 初始化、历史数据源及实时订阅。
- lib/market-client.ts：前端 HTTP 与 SSE 请求封装。
- utils/market.ts：格式化、剪贴板、行情合并和连续 K 线展示。
- utils/transaction-pagination.ts：手机按页面视口、PC 按列表容器触底加载，支持屏幕旋转。
- utils/tradingview-loader.ts：共享图表脚本加载，下载超时和失败重试。
- lib/market.ts：共享类型，不导入历史 JSON。
- lib/market-reader.ts：服务端运行时读取与一秒共享缓存。
- lib/market-api.ts：快照裁剪、K 线分页、交易游标。
- lib/market/config.mjs：链、合约、RPC 和环境配置。
- lib/market/providers.mjs：RPC、固定区块储备读取、分段日志查询。
- lib/market/events.mjs：Swap/Mint/Burn/Sync 解析。
- lib/market/wallets.mjs：按交易哈希查询 `transaction.from`，去重、限并发、失败重试。
- lib/market/wallet-backfill.mjs：只补齐历史地址，备份及文件变化检查。
- lib/market/writer-lock.mjs：监听、重建、补齐共用的单写者锁。
- lib/market/aggregation.mjs：K 线和指标聚合。
- lib/market/storage.mjs：持久化及临时文件原子替换。
- lib/market/service.mjs：追块、实时监听、重连与历史合并。
- scripts/：监听器、手动全量同步和历史交易地址补齐的命令行入口。
- deploy/：PM2 进程配置和 Nginx 示例。

组件和关键的数据一致性处理均有注释。UI 使用本地 shadcn 风格组件与 lucide-react；链上访问使用 ethers。

## 环境与启动

使用 Node.js 22 或更新的兼容版本，以及 npm。安装：

~~~bash
npm ci
~~~

复制 .env.example 为所需环境文件并填写：.env.development / .env.test / .env.production。
环境文件不提交到 Git；所有环境目前连接同一条链，不是三条不同链。

关键配置：

~~~dotenv
MARKET_CHAIN_ID=1677
EVM_RPC_URL=https://rpc.interstellarchain.org/
EVM_WS_URL=wss://rpc.interstellarchain.org
DEX_PAIR_ADDRESS=0xe51a1b18727c17e01ccd87008255d8a7abf4a006
BASE_TOKEN_ADDRESS=0x8AF5Da3DEA6eFe400Ddab5baE395eE3c818d325A
QUOTE_TOKEN_ADDRESS=0xA7eAA7BB5284D37bf24FB91077Fa040f01B0C703
QUOTE_DISPLAY_SYMBOL=HUGE
MARKET_START_BLOCK=219335
MARKET_LOG_CHUNK_SIZE=2000
MARKET_DATA_FILE=data/market.json
NEXT_PUBLIC_NETWORK_NAME=InterstellarChain
NEXT_PUBLIC_EXPLORER_URL=https://scan.interstellarchain.org/
~~~

BASE/QUOTE 合约配置沿用内部 NFX/WHUGE 顺序，显示方向由读取层转换为 HUGE/NFX。
不同环境如同时运行，必须给 MARKET_DATA_FILE 设置不同路径，避免多个 Worker 覆盖同一个文件。

本地启动需要两个终端：

~~~bash
npm run market:watch:dev
~~~

~~~bash
npm run dev
~~~

浏览器打开终端输出的地址，默认 http://localhost:3000。
watch 首次无文件时从 219335 扫描；已有数据时从 history.lastBlock + 1 追到最新，然后持续监听。
WebSocket 自动退避重连，HTTP 每 30 秒检查区块作兜底。历史不按天数删除。
测试配置使用 market:watch:test；生产使用 market:watch:prod。

market:sync:dev / market:sync:test / market:sync:prod 会从起点全量重建文件。
仅在停掉对应 watcher 并备份后执行，不要让 sync 与 watcher 同时写同一文件。

买卖和加减流动性的交易者统一取交易本身的 `from`，不是 Pair 事件的 `sender` 或 `to`。
一个交易哈希只查询一次，同时最多查询 4 笔，失败最多尝试 3 次。地址查询失败时不写本批次、不推进扫块断点，下一次区块检查重新尝试。
`sender` 和 `recipient` 保留池子事件原始信息；`wallet` / `transactionFrom` 表示交易发起地址，`walletSource` 为 `transaction.from`。
通过智能钱包或中继发出的交易，`from` 是链上交易发起者，不保证等于最终受益人或智能钱包背后的用户。

## Linux 生产部署

部署模型为常驻 Next.js Web + 单个常驻行情 Worker + 可持久化磁盘。
当前文件存储不适合多副本共同写入，也不适合没有持久磁盘的短时 Serverless 任务。

1. 上传源码、package-lock.json 和 public/charting_library；无需上传 node_modules、.next、开发环境文件和 data/market.json。
2. 创建 .env.production，设置独立持久路径，例如 MARKET_DATA_FILE=/var/lib/interstellar-market/market.json。目录需由运行进程的系统用户读写；Web 与 Worker 使用相同路径。
3. 在项目目录安装并构建：

~~~bash
npm ci
npm run build
~~~

4. 若服务器已安装 PM2，在项目目录运行：

~~~bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup
~~~

按 pm2 startup 输出完成系统开机启动设置。配置启动 chart-web 和 chart-watch，Worker 实例数必须是 1。
未使用 PM2 时，可在两个受进程管理器托管的终端分别运行 npm run start 与 npm run market:watch:prod。

5. 配置 Nginx，参考 deploy/nginx.conf.example，替换域名并配置 HTTPS。检查配置后重载 Nginx。
SSE 路径必须关闭代理缓冲和缓存，并允许长连接；CDN 或负载均衡也要遵循相同设置。
6. 验证：

~~~bash
pm2 status
pm2 logs chart-watch --lines 50
curl -f http://127.0.0.1:3000/api/market
curl -N --max-time 20 http://127.0.0.1:3000/api/market/stream
~~~

SSE 应出现 data 事件及心跳。无 JSON 或首次扫描未完成时 JSON 接口返回 503；同步完成后自动恢复。
检查返回的 history.lastBlock 随链推进，浏览器显示 SSE 已连接。

更新代码时保留持久目录和 .env.production，重新 npm ci、npm run build 后执行：

~~~bash
pm2 restart deploy/ecosystem.config.cjs --update-env
~~~

NEXT_PUBLIC_* 是构建时变量，修改后必须重新构建。

## 已上线版本修复历史交易地址

**保留线上原有 market.json，不用上传本地 JSON，不用全量重新扫块。**
修改解析逻辑只影响新记录；旧记录必须在对应环境执行一次地址补齐。仅重启 watcher 不会自动修复旧地址。

将本次代码提交并推送到 Git 后，在服务器项目目录执行以下第一组命令。安装、构建失败时先解决错误，不要继续后面的步骤：

~~~bash
cd ~/chart
git pull
npm ci
npm run build
pm2 stop chart-watch
npm run market:wallets:prod
~~~

补齐命令读取 `.env.production` 中的 `MARKET_DATA_FILE`，自动在原文件旁生成 `market.json.wallet-backup-时间-随机标识.json`，并打印完整备份路径。
然后按已有交易哈希查询发起地址，补齐 `history.events` 及首页 `transactions`。重复运行会跳过已补齐的记录。
不会删除事件、不改 K 线／价格／成交金额，也不会改变 `history.lastBlock`、区块时间或事件顺序。旧的展示地址保存为 `legacyWallet`。
查询中途失败不覆盖原文件；不要删除 JSON 或改用 `market:sync:prod`，保留错误输出和备份排查。

**看到“完成”或“所有交易地址已补齐”后**，再执行第二组命令：

~~~bash
pm2 restart chart-web --update-env
pm2 restart chart-watch --update-env
pm2 save
pm2 logs chart-watch --lines 30 --nostream
~~~

Web 可以在补齐期间继续提供旧快照，但暂停监听期间行情暂不更新。监听恢复后从原断点追到最新区块，补上暂停期间的交易。
浏览器重新加载页面以清除页面内已加载的旧交易记录，检查交易者地址与浏览器交易详情的 `From` 一致。
本地开发／测试分别用 `npm run market:wallets:dev` / `npm run market:wallets:test`，也必须先停对应 watcher。

新版写入命令共用 `MARKET_DATA_FILE + .lock` 锁，避免同时写同一文件；正常停止会释放。
若被 `SIGKILL` 等强制结束，锁可能残留。**先确认该文件对应的所有 watcher／sync／wallets 命令均已停止**，再把错误信息中指出的那个锁文件移到备份位置；不能删除行情 JSON，也不要在进程还运行时移走锁。
旧版本进程不认识这个锁，因此升级时仍必须显式执行 `pm2 stop chart-watch`，补齐还会检查原文件是否在查询期间被改动。

## JSON 能不能删除？

**不需要把本地 JSON 上传到服务器，但已运行服务器上的唯一历史文件不能随意删除。**

- 保留历史并快速接续：停掉旧 watcher，备份并复制完整 market.json 到新服务器持久目录，再启动新 watcher。它从已保存断点继续。
- 接受全量重建：部署时不带 JSON，首次 watcher 自动从 219335 重扫。重建期间没有历史行情可显示，耗时取决于区块数及 RPC。
- 已运行环境要重建：先停止 watcher，把旧文件移到备份位置，再启动 watcher。不要只清空 events 后保留 lastBlock，这会跳过被清空的历史。
- 文件损坏会报错，不会被当作新安装悄悄覆盖。应恢复备份或按上述流程重建。

构建已与数据文件解耦；data/*.json 已加入 Git 忽略（不会自动取消 Git 对已跟踪文件的跟踪）。
后续写入使用紧凑 JSON，省去缩进空白；已有文件不会为了压缩而被立即覆盖，也没有删除历史。
market.json 包含所有事件和派生 K 线，规模会持续增长。前端分页减少网络响应，但后端仍需读取完整文件、聚合完整历史，不能认为分页解决了存储扩展。
长期大量数据应迁移到数据库，按事件唯一键和时间/区块索引查询；当前版本尚未实现数据库存储。
持久目录需定期备份到另一位置，并监控磁盘空间。

## 接口与实时更新

| 路径 | 用途 |
| --- | --- |
| GET /api/market | 首屏精简快照，最近 K 线和交易；full=true 可读取完整历史，避免频繁调用 |
| GET /api/market/candles | interval、from、to、before、limit 分页读取 K 线，最多 2000 条原始柱 |
| GET /api/market/transactions | cursor、limit 分页读取交易，最多 200 条 |
| GET /api/market/stream | SSE 推送现价、储备、最近柱和事件；15 秒心跳 |

Web 服务只读。原 POST /api/market 已移除（返回 405），避免公网触发重建、多个进程覆盖文件或储备刷新推进历史断点。
同步和重建使用 CLI 命令。页面刷新按钮只重新读取行情，不直接写链或重新扫描。

浏览器 SSE 失败时退回每 10 秒请求快照，重连后恢复 SSE。历史分页保留已加载内容，失败后点击刷新可重试。
服务端同一进程一秒内共享 JSON 读取结果，避免每个 SSE 客户端重复解析大文件。

交易列表的买卖记录同时显示 HUGE 成交数量、成交均价（NFX/HUGE）和成交 NFX 总额。
均价为该笔 Swap 的 NFX 数量 ÷ HUGE 数量；总额直接使用链上事件的 `quoteAmount`，不从四舍五入后的显示价格反算。
添加／移除流动性记录在成交量列显示两种代币数量，成交均价和成交额显示 `—`，避免把流动性操作误标为成交。
交易列表采用六列表格：时间、类型、成交均价、成交量、成交额、交易者。买入绿色、卖出红色、流动性蓝色，PC 表头固定、行背景交替。
移动端保留全部列并支持列表内部横向滑动，时间点击查看交易详情、交易者地址点击复制；复制成功状态只影响对应的一条记录。
移动端交易列表不再限制纵向高度：手指从列表内上下滑动时滚动整个页面，页面接近列表底部时自动加载更早记录；PC 保留列表内部滚动。
页面顶部 header 提供 `0x / hg` 开关，默认 `hg`，统一控制交易列表地址显示和复制格式。
选择保存在浏览器 `localStorage`（`chart-transaction-address-type`），刷新或关闭后再打开仍保留；更换浏览器／设备或清除网站数据后恢复默认。无痕模式或存储不可用时仅在当前页面生效。
复制的是当前格式的完整地址。
该功能沿用 Swap 项目的 `hg` Bech32 编码方式（20 字节账户地址）。只转换交易者的展示／复制，不修改 API、扫块和 `market.json` 中的原始地址，LP 地址也保持不变。

## K 线口径和当前限制

支持 1m / 5m / 15m / 1h / 4h / 1d。连续展示时无交易周期补上一收盘价、成交量为零；下一根展示开盘价接上一根收盘价，高低价包含这个开盘价。
这与“第一笔成交价作为开盘价”口径不同，原始交易和 JSON 不被前端改写。
当前价格使用池子储备 NFX/HUGE；最新柱收盘价与价格卡片统一。TradingView 属性和顶部周期选择在浏览器本地保存，不代表完整行情已离线保存。

手机图表上方额外显示“最新 K 线”的开、高、低、收，随顶部周期选择和 SSE 行情更新，单位为 NFX/HUGE，显示精度与图表价格轴一致（最多两位小数）。数值使用同一补柱和池子价格逻辑，不改写 JSON。该栏始终表示最新柱，不随十字光标移动；长按历史蜡烛可在 TradingView 自带图例中查看那根柱的数据。
移动端默认收起 OHLC 的行为见 [TradingView 移动端说明](https://www.tradingview.com/charting-library-docs/latest/mobile_specifics/)。PC 保持原布局，图表高度和滚动设置不变。

移动浏览器使用 TradingView 的 `iframe_loading_compatibility_mode`，以 `about:blank` 替代默认的 `blob:` iframe；所有数据源回调异步执行。脚本下载、K 线分页请求设置 25 秒超时，图表初始化设置 45 秒超时。失败时图表区域会显示具体原因和“重新加载图表”按钮，无需重载整个页面。
该模式与异步回调的说明见 [TradingView 故障排查](https://www.tradingview.com/charting-library-docs/latest/troubleshooting/) 和 [Datafeed API](https://www.tradingview.com/charting-library-docs/latest/connecting_data/datafeed-api/)。

K 线禁用 `vert_touch_drag_scroll`，普通纵向触摸交给页面滚动；横向拖动历史 K 线、双指缩放及 PC 鼠标操作仍保留。长按进入十字光标等图表交互时可能仍由图表处理，轻点退出后恢复普通滑动。
对应设置见 [TradingView 触摸滚动配置](https://www.tradingview.com/charting-library-docs/latest/customization/Featuresets/#vert_touch_drag_scroll)。

已知限制：历史事件时间目前按区块采样估算，尚未逐个读取真实区块时间；极短周期可能有时间桶偏差。当前监听器没有链重组回滚机制。精确历史分析或正式扩大使用前应补齐这些能力。
SSE 只带最近事件，极长断线或短时大量交易仍需通过历史分页读取完整记录。

## 检查命令

~~~bash
npx tsc --noEmit
npm run lint
npm run test:market
npm run test:ui
npm run build
~~~
