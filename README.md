# chart

移动端优先的 HUGE / NFX 行情页：TradingView K 线、池子储备、涨跌幅和实时交易列表。
价格为 **1 HUGE 等于多少 NFX**；HUGE 对应链上的 WHUGE。没有 USD 价格，priceUsd 为 null。

项目 Logo 为透明 PNG：`public/brand/chart-logo.png` 是原始高清文件，顶栏通过 Next Image 按显示尺寸优化加载；`app/favicon.ico` 是同一标志的传统标签页图标，包含 16/32/48/64 像素四个尺寸，由 Next.js 自动生成图标标签并提供 `/favicon.ico`。不再保留 `app/icon.png`，避免浏览器同时选择不同图标。HUGE / NFX 代币 Logo 不受影响。设计说明与生成提示词见 [docs/brand-logo.md](docs/brand-logo.md)。仅更新品牌资源无需重扫链，生产部署重新构建并重启 Web 即可；浏览器若仍显示旧图标，可用无痕窗口验证或清理站点缓存。

## 项目结构与职责

- app/page.tsx：页面布局和组件组合。
- hooks/use-market-dashboard.ts：行情状态、SSE/备用轮询、周期偏好、交易分页。
- hooks/use-market-health.ts：独立于 SSE 的行情新鲜度检查，15 秒刷新及前后台恢复。
- components/market/market-freshness.tsx：行情正常/追块/过期提示及区块高度说明。
- utils/market-recovery.ts：按固定区块窗口补齐断线交易与 K 线，拒绝跨历史版本拼接。
- components/market/pair-summary.tsx：交易对信息、价格、储备和统计。
- components/market/market-header.tsx：页面顶栏、实时连接状态和地址格式开关。
- components/market/chart-panel.tsx：交易对标题、周期切换和图表容器。
- components/market/market-workspace.tsx：图表独立高度拖拽、固定高度交易区与共用页面滚动。
- hooks/use-chart-height.ts：图表独立高度拖拽、键盘调整、结束/取消与监听清理。
- utils/terminal-layout.ts：像素高度校验与本地持久化。
- components/market/transactions-panel.tsx：交易筛选、八列表格和触底加载。
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
- lib/market-api.ts：分页参数校验与交易游标解码；分页查询统一在 SQL 中执行。
- lib/market/config.mjs：链、合约、RPC 和环境配置。
- lib/market/providers.mjs：RPC、固定区块储备读取、分段日志查询。
- lib/market/events.mjs：Swap/Mint/Burn/Sync 解析。
- lib/market/wallets.mjs：按交易哈希查询 `transaction.from`，去重、限并发、失败重试。
- lib/market/wallet-backfill.mjs：只补齐历史地址，先备份，再校验数据库修订号。
- lib/market/writer-lock.mjs：监听、追块、补齐共用的单写者锁。
- lib/market/aggregation.mjs：K 线和指标聚合。
- lib/market/database.mjs：SQLite 表结构、版本检查、WAL 和短事务。
- lib/market/repository.mjs：有界快照、索引分页与数据校验。
- lib/market/indexer-store.mjs：增量事件、受影响 K 线桶、24h 指标与断点的原子提交。
- lib/market/indexer.mjs：首次扫描/补块共用的分批扫描流程。
- lib/market/chain-integrity.mjs：真实区块时间、旧时间校正、哈希校验及重组回退。
- lib/market/health.mjs：Worker 探测信息落盘及只读新鲜度判断。
- lib/market/data-maintenance.mjs：在线数据库备份与完整性检查。
- lib/market/service.mjs：实时监听、重连与 HTTP 兜底。
- lib/market/process-lifecycle.mjs：启动前安装停止信号处理，校正/追块期间也可取消并释放写锁。
- scripts/：监听、追块、数据库备份和历史地址补齐入口。
- deploy/：PM2 进程配置和 Nginx 示例。

组件和关键的数据一致性处理均有注释。UI 正式使用 shadcn/ui（Radix / New York）的官方组件源码与 lucide-react；链上访问使用 ethers。

### UI 组件与维护

已接入 Button、Card、Badge、Popover、Tabs、Toggle、ToggleGroup、Table、Alert、Tooltip，源码位于 `components/ui/`，来自 [shadcn/ui 官方组件仓库](https://ui.shadcn.com/docs/components/radix/popover)，保留 MIT 许可（`components/ui/LICENSE.md`）。这是 shadcn 的源码分发方式，不是只写相似 CSS。Radix 负责交互、键盘导航、焦点管理；`class-variance-authority` 管理变体，`lib/utils.ts` 的 `cn()` 合并样式。

- `components.json` 配置组件目录与别名；已有 Tailwind v4，因此 tailwind.config 留空。以后可按需运行 `npx shadcn@latest add 组件名`，不要重新 `init` 或直接 `--overwrite` 覆盖本地适配。
- 全局主题采用 shadcn 语义变量映射到现有蓝黑配色，没有换成默认黑白主题。`--muted` 现在表示低强调背景，原来的灰色文字变量改为 `--muted-foreground`。
- 地址/周期选择使用单选 ToggleGroup，已选项不能被清空；交易筛选使用 Tabs，常用图表指标使用独立 Toggle + Tooltip。复制和外部链接使用 Button（链接通过 `asChild` 保持 `<a>` 语义）。
- 问号说明改为 Popover，Portal 渲染到页面外层，避免卡片 `overflow` 裁切；支持点击/键盘打开、Esc/点击外部/关闭按钮关闭，并恢复适当焦点。设置视口避碰、宽度及可用高度限制，手机可阅读。
- Table 的 `containerClassName="overflow-visible"` 是本地滚动适配，继续由原来的 `.transaction-list` 管理滚动，不能再嵌套一个纵向 ScrollArea，避免破坏手机页面滚动、固定表头或分页观察器。
- `npm run test:ui` 包含 SSR/配置回归与 JSDOM 下的真实 Radix 交互测试（不代替真机视觉/手势验证）；新依赖随 package-lock 发布，部署仍按下文 `npm ci`、构建、重启 Web 即可，不需要重扫链。

## 环境文件与运行要求

使用 **Node.js 24.21.0 或更新的 24.x 版本**（与现有服务器一致）以及 npm。SQLite 使用 Node 内置 `node:sqlite`，无需安装 MySQL、SQLite 服务进程或额外原生 npm 包。不要改用旧 Node 22；当前测试环境为 Node 24.21.0。安装：

~~~bash
npm ci
~~~

**`.env.development`、`.env.test`、`.env.production` 和 `.env.example` 都随 Git 提交。**
它们只包含公开的链 ID、RPC 地址、合约地址、数据库路径和页面配置，没有钱包私钥或其他凭据。服务器拉取代码后已经有环境文件，**不需要复制模板或重新创建 `.env.production`**。
所有环境目前连接同一条链，不是三条不同链。以后如果接入付费 RPC 密钥、密码、私钥或 SSH 凭据，不要把它们写进这些公开文件；应通过服务器进程环境变量等方式单独提供。

| 文件 | 使用场景 | 当前数据库路径 |
| --- | --- | --- |
| `.env.development` | 本地 Web 与 `market:*:dev` 命令 | `data/market.db` |
| `.env.test` | `market:*:test` 命令 | `data/market.test.db` |
| `.env.production` | 生产 Web、PM2 Worker 与 `market:*:prod` 命令 | `data/market.db` |
| `.env.example` | 公开配置参考，不是运行时必需文件 | `data/market.db` |

环境配置需要修改时，建议在本地修改相应文件并提交、推送，服务器再拉取更新。避免只在服务器修改 Git 已跟踪的环境文件，否则下次 `git pull` 可能因本地改动而被阻止。
仅本机使用的 `.env.local` / `.env.*.local` 被忽略，不提交；行情 Worker 不会自动加载它们，避免 Web 和 Worker 使用了不同数据库路径。

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
MARKET_DATA_FILE=data/market.db
NEXT_PUBLIC_NETWORK_NAME=InterstellarChain
NEXT_PUBLIC_EXPLORER_URL=https://scan.interstellarchain.org/
~~~

BASE/QUOTE 合约配置沿用内部 NFX/WHUGE 顺序，显示方向由读取层转换为 HUGE/NFX。
`MARKET_DATA_FILE` 必须指向 `.db` / `.sqlite` / `.sqlite3`。项目只使用 SQLite，不读取旧行情 JSON，不提供 JSON 导入或兼容模式。
默认开发和生产在不同机器运行，因此都可以使用相对路径 `data/market.db`。若要在同一机器同时运行多个环境，必须设置不同数据库路径，不能启动多个 Worker 写同一个库。

## 本地开发启动

本地启动需要两个终端：

~~~bash
npm run market:watch:dev
~~~

~~~bash
npm run dev
~~~

浏览器打开终端输出的地址，默认 http://localhost:3000。
watch 无数据库时自动创建 SQLite，从 219335 扫描；已有数据库时从已提交的 lastBlock + 1 追到最新，然后持续监听。首次直接运行 watch 即可，不需要提前建表或导入文件。
每批最多 `MARKET_LOG_CHUNK_SIZE` 个区块，事件、K 线、指标、断点在同一 SQLite 事务中提交。中途失败保留先前成功批次；零事件区块也保存断点，重启不会重复全扫。
历史池子储备由 V2 `Sync` 日志还原，无事件的批次延续上批储备，不要求 RPC 支持旧区块的 `eth_call`。只在本轮最新目标区块读取链上储备与代币信息，最后一批校准现价；首次起点应覆盖池子首次活动区块（本池为 219335）。
储备更新与 `Sync` 的对应关系见 [PancakeSwap V2 Pair 源码](https://github.com/pancakeswap/pancake-swap-core/blob/master/contracts/PancakePair.sol)。
WebSocket 自动退避重连，HTTP 每 30 秒检查区块作兜底。历史不按天数删除。
测试配置使用 market:watch:test；生产使用 market:watch:prod。

market:sync:dev / market:sync:test / market:sync:prod **现已改为从断点追到命令启动时的最新区块后退出**，不清空或全量重建已有历史。通常直接运行 watch 即可。
不要让 sync、wallets 与 watcher 同时写同一数据库，单写者锁会阻止这些操作。

买卖和加减流动性的交易者统一取交易本身的 `from`，不是 Pair 事件的 `sender` 或 `to`。
一个交易哈希只查询一次，同时最多查询 4 笔，失败最多尝试 3 次。地址查询失败时不写本批次、不推进扫块断点，下一次区块检查重新尝试。
`sender` 和 `recipient` 保留池子事件原始信息；`wallet` / `transactionFrom` 表示交易发起地址，`walletSource` 为 `transaction.from`。
通过智能钱包或中继发出的交易，`from` 是链上交易发起者，不保证等于最终受益人或智能钱包背后的用户。

## 服务器全新部署（Ubuntu / Git / PM2）

适用于服务器第一次安装，或你决定移走旧项目后从 Git 重新安装。**无需上传本地数据库、导入 JSON 或提前建表；新库由 Worker 自动创建并从 219335 开始扫描。**
以下示例使用 `/home/ubuntu/chart`，分支为 `feature/develop`。不同用户名或目录请替换成实际路径。

### 1. 先提交并推送本地代码

在本地把本次代码改动和公开环境文件一起提交到 `feature/develop` 并推送。只在本地改好但没推送，服务器就拉不到新代码。
`data/` 中的数据库、WAL/SHM、锁和备份，以及 `node_modules` / `.next` 不提交；它们已配置 Git 忽略。
确认 `public/charting_library` 已在仓库中，否则服务器没有 TradingView 图表资源。

### 2. 检查服务器环境

需要 Node.js **24.21.0 或更新的 24.x**、npm、Git、PM2。已有这些工具可直接使用，不用重装，也不用安装数据库服务。

~~~bash
node -v
npm -v
git --version
pm2 -v
~~~

### 3. 清理旧进程，保留旧项目作为备份（已有项目才执行）

~~~bash
pm2 delete chart-watch
pm2 delete chart-web
cd /home/ubuntu
mv -T -n chart chart-backup-20261013
~~~

若 PM2 提示进程不存在，可以忽略。项目已经删除或首次安装时，跳过改名操作。
`mv -T -n` 不覆盖已存在的备份；若备份目录已存在，应先换一个新备份名，并确认 `chart` 已移走，再继续克隆。不要先删除正在使用的数据库。

### 4. 从 Git 拉取项目

把下面的 `你的Git仓库地址` 替换为真实仓库地址：

~~~bash
cd /home/ubuntu
git clone --branch feature/develop 你的Git仓库地址 chart
cd /home/ubuntu/chart
git branch --show-current
~~~

输出应为 `feature/develop`。环境文件已随仓库拉取，不需要复制 `.env.example`。

### 5. 确认生产配置与数据库位置

仓库 `.env.production` 默认配置如下，可以直接使用：

~~~dotenv
MARKET_DATA_FILE=data/market.db
MARKET_START_BLOCK=219335
~~~

在本示例中，实际数据库位置就是 **`/home/ubuntu/chart/data/market.db`**，Web 和 Worker 都读取它。Worker 会自动创建目录、数据库和表。
数据库不存在：从起点扫描；数据库已存在：从最后成功区块继续。拉取代码不会带来本地数据库，也不会自动清空服务器已有库。

如果希望以后删除项目目录也不丢数据库，可在本地将 `.env.production` 的 `MARKET_DATA_FILE` 改为 `/home/ubuntu/chart-data/market.db`，提交推送后在服务器拉取，并执行 `mkdir -p /home/ubuntu/chart-data`。这个路径同样是公开配置，不需要 Secret 平台。目录必须由运行 PM2 的用户读写。
**使用项目内默认路径时，删除整个 `chart` 目录也会删除数据库；日常更新不能删目录重装。**

### 6. 安装依赖并构建

~~~bash
cd /home/ubuntu/chart
npm ci
npm run build
~~~

任何一步失败，都先解决错误，不继续启动。

### 7. 启动网站和行情监听器

~~~bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
~~~

配置会启动两个常驻进程：

- `chart-web`：生产网站，监听 `127.0.0.1:3000`。
- `chart-watch`：首次自动扫历史，追到最新后持续监听。Worker 实例数必须为 1。

**不要另外运行 `market:sync:prod` 或手动再启动 `market:watch:prod`；PM2 已经启动了监听器。**
第一次配置开机自启时，再运行 `pm2 startup`，按输出执行它提供的命令，然后运行 `pm2 save`。已配置好的服务器不用重复设置。

### 8. 检查服务与域名

~~~bash
pm2 status
pm2 logs chart-watch --lines 30 --nostream
curl -f http://127.0.0.1:3000/api/market
curl -N --max-time 20 http://127.0.0.1:3000/api/market/stream
~~~

两个进程应为 `online`，扫块日志出现 `(SQLite)`，区块编号持续前进。`+0 events` 只表示这一批没有池子活动，不是扫描停止。
第一批写入前接口可能返回 503；追块期间展示的是已扫描到的历史行情，追到最新后才是当前行情。中途停止后重启会从最后成功批次继续，不会重新扫已完成部分。
SSE 应输出 `data:` 与约每 15 秒一次的心跳；上述命令 20 秒后主动结束，出现超时退出属于这条检查命令的预期行为。

原有 Nginx 若已将 `chart.instl.org` 代理到 `127.0.0.1:3000`，无需因重新拉取项目而修改；证书和 `/etc/nginx` 配置也不在项目目录内。
新服务器需配置 HTTPS 与 Nginx，代理示例见 `deploy/nginx.conf.example`。SSE 路径 `/api/market/stream` 必须关闭代理缓冲/缓存并允许长连接；CDN 或负载均衡也要遵循相同设置。
本机接口正常且 Nginx 已配置后，访问 `https://chart.instl.org`。

部署模型是同机持久磁盘上的一个 SQLite 库、一个 Worker 写入、Web 只读。不要把数据库放在 NFS 等网络共享盘，也不要部署成无持久磁盘的短时 Serverless 任务。

## 日常更新（保留数据库，不重新扫历史）

本地修改代码或公开环境文件后，提交并推送；服务器无需删除项目或重建数据库。以下命令会短暂停止服务，避免构建期间仍提供旧资源：

~~~bash
cd /home/ubuntu/chart
pm2 stop chart-watch
pm2 stop chart-web
git pull --ff-only origin feature/develop
npm ci
npm run build
pm2 restart deploy/ecosystem.config.cjs --update-env
pm2 save
~~~

拉取、安装、构建失败时先停止后续步骤并排查，不要强制覆盖服务器改动或删除数据库。
更新后 Worker 从已保存断点补上停机期间的新区块。`NEXT_PUBLIC_*` 是构建时配置，修改后必须重新构建；其他环境配置修改后也要重启对应进程。

### 本次升级：真实时间与重组保护（不删数据库，不重新全扫）

按上述日常更新命令重启 **Web 和 chart-watch 两个进程**。旧 Worker 不会自动加载新版扫描逻辑，只有 Web 更新时页面会显示“行情状态未知”。无需新增环境变量，仍使用现有 `.env.production` 和 `MARKET_DATA_FILE`。

- Worker 首次启动会自动备份旧库；只读取已有事件对应的活动区块和保存断点的真实时间，校正交易时间，重建六周期 K 线和 24h 统计。并发最多 4 个区块请求，不重新从起点扫描全部区块。
- RPC 全部成功且数据库修订号仍一致才原子提交。失败保留旧事件、K 线和断点，日志打印备份位置，重试即可；不要删除数据库或锁文件来绕过正在运行的进程。
- 校正可能改变交易所属时间桶、历史 OHLC/成交量和 24h 统计，这是修正旧估算时间的结果，不是历史被清理。首次升级耗时取决于活动区块数量与 RPC 延迟，期间页面可显示旧数据，但不得当成最新行情。
- `history.timestampVersion = 1` 表示真实时间；`datasetVersion` 在时间校正/重组时改变，前端会清除旧行情内存并重新读页，图表设置与画线仍保留。普通逐块更新只增加 `revision`。
- 后续逐批检查断点哈希和日志 `blockHash`。发现浅重组会先备份，再回退到已验证的共同锚点，仅移除孤块事件、重建派生数据并追到新主链；有效历史永久保留。保留最近 **512 个批次锚点，不是 512 个区块**。升级初始只有一个锚点，之后随扫描积累。
- 找不到共同锚点的深重组、节点高度低于保存断点、区块时间/哈希缺失等情况暂停写入并报错，不自动清空重扫。应保留数据库、备份与日志后人工核查 RPC/链状态。
- 启动校正、追块、监听都处理 SIGINT/SIGTERM，取消后不提交未完成批次，退出前释放自己的写锁；RPC 单请求最多等待 20 秒。SIGKILL/断电不可捕获，若留下锁仍须先确认进程已停止，不能自动删锁。Pair 元数据在 Worker 进程内复用，实时储备仍按目标区块查询，减少不必要的 RPC 往返。

升级后可用 `curl -i http://127.0.0.1:3000/api/market/health` 检查；追到最新、探测与链时间正常时应返回 200/`healthy`。正常追块返回 200/`catching_up`，不因链头与写入之间短暂相差几块而制造浏览器错误；仍需看响应中的 `status/reason` 判断是否追平。未就绪、过期、监控未知或数据库不可读仍返回 503。要求完全追平的服务器就绪检查使用 `/api/market/health?strict=1`，此时只有 `healthy` 返回 200。

## 可选维护：修复历史交易地址

新扫记录会直接查询正确的 `transaction.from`，一般不需要执行补齐命令。下述命令仅用于以后修复现有 SQLite 中的旧/异常地址，不需要重扫，也不涉及 JSON。

此步骤不是部署流程的一部分。仅确实需要修复地址时，在已部署的服务器执行以下命令：

~~~bash
cd /home/ubuntu/chart
pm2 stop chart-watch
npm run market:wallets:prod
~~~

补齐命令读取 `.env.production` 中的 `MARKET_DATA_FILE`，自动在原文件旁生成 `market.db.backup-时间-随机标识.db` 独立快照，并打印完整备份路径。
然后按已有交易哈希查询发起地址，只修改待修复事件行；首页交易直接查询同一批事件。重复运行会跳过已补齐的记录。
不会删除事件、不改 K 线／价格／成交金额，也不会改变 `history.lastBlock`、区块时间或事件顺序。旧的展示地址保存为 `legacyWallet`。
查询中途失败不修改原数据库；不要删除数据库，保留错误输出和备份排查。

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

新版写入命令共用 `MARKET_DATA_FILE + .lock` 锁，避免同时写同一数据库；正常停止会释放。遇到占用错误时，按下文“写入锁与残留锁处理”检查，不要直接删锁或删除数据库。
补齐还会检查数据库修订号，防止非协作写入者在 RPC 查询期间推进断点后被覆盖。

## 写入锁与残留锁处理（本地 / 线上）

### 锁文件是什么，线上有没有？

本地和线上都有。它是应用层的单写者锁，防止 watcher、sync、wallets 等命令同时修改同一个行情库；不是 SQLite 数据库，也不是需要定期清理的缓存。

锁路径为当前环境的 **`MARKET_DATA_FILE + .lock`**：

| 环境 | 默认数据库 | 默认锁文件 |
| --- | --- | --- |
| 本地 `.env.development` | `data/market.db` | `data/market.db.lock` |
| 测试 `.env.test` | `data/market.test.db` | `data/market.test.db.lock` |
| 线上 `.env.production` | `data/market.db` | `data/market.db.lock` |

相对路径以进程工作目录为准。例如线上项目位于 `/home/ubuntu/chart` 时，默认锁是 `/home/ubuntu/chart/data/market.db.lock`。如果数据库改到 `/home/ubuntu/chart-data/market.db`，锁也随之变成 `/home/ubuntu/chart-data/market.db.lock`。**以当前环境配置和报错中的完整路径为准，不要处理另一个环境的锁。**

- 监听正在运行：锁存在是正常现象，第二个写入命令会被拒绝。
- 正常停止：新版 watcher/sync 处理 SIGINT/SIGTERM，完成清理后释放自己的锁；正常 PM2 重启会由旧进程释放、新进程重新创建。wallets 等其他维护命令应尽量等待正常完成，中断后也要检查是否有残留锁。
- 强制结束、断电或 PM2 超过停止等待时间后强杀：锁可能残留。当前 `chart-watch` 的 `kill_timeout` 为 30 秒，不能保证强杀时执行清理。
- 锁里记录 `pid`、`purpose`、`startedAt` 等信息。**只看到锁存在、文件时间很旧或 PM2 报错，都不能证明它可以清理。**

### 1. 先停止写入进程

本地：到原来运行 `npm run market:watch:dev` 的终端按 **Ctrl+C**，等待停止；其他终端正在运行的 sync / wallets 命令也要正常停止。关闭网页或停止 Next.js Web 服务，不等于停止 watcher。

线上：先停止 PM2 的监听器，避免自动重启期间与检查/清锁竞争：

~~~bash
cd /home/ubuntu/chart
pm2 stop chart-watch
pm2 status
~~~

确认 `chart-watch` 为 `stopped`，同时确认没有手动启动的 `market:watch:prod`、sync、wallets 或其他进程管理器启动的写入进程。Web 只读，一般不必为清理残留锁停止 `chart-web`，但此时页面会提示行情更新中断。

### 2. 查看锁并确认 PID 已退出

以下示例使用默认 `data/market.db.lock`，请在项目根目录执行；测试环境或自定义路径需换成实际锁路径。如果正常停止后锁已经不存在，直接跳到第 4 步，不用清理。

~~~bash
cat data/market.db.lock
~~~

找到输出中的 `"pid"`，例如 `57719`，然后检查：

~~~bash
ps -p 57719 -o pid,command
~~~

**`57719` 仅是示例，必须替换成你刚读取的 PID。**

- 仍显示进程：先核实并停止对应写入进程，不要移走锁。PID 也可能已被其他程序复用，不要盲目杀进程。
- 只剩表头、没有进程记录：该 PID 已不存在；还要确认第 1 步中的其他写入命令均已停止，才能继续。
- 权限不足、无法读取锁、锁内容损坏或进程状态不确定：停止操作，保留错误信息排查，不要当作“进程已退出”。线上应使用运行 PM2 的同一用户检查。

### 3. 仅将确认残留的锁改名保留

确认没有任何进程写入该数据库后，执行：

~~~bash
mv -n data/market.db.lock "data/market.db.lock.stale-$(date +%Y%m%d-%H%M%S)"
~~~

这只保留一个带时间的锁备份，不修改行情或断点；`-n` 防止覆盖已有备份。不要直接 `rm`，不要通过删锁绕过仍在运行的进程。若启动仍报占用，重新检查实际路径和进程，不要连续强制清锁。

**不要删除 `market.db`、`market.db-wal` 或 `market.db-shm`。** WAL/SHM 是 SQLite 的工作文件，不是本节处理的 `.lock`；删除它们可能损坏数据或丢失已提交历史。

### 4. 恢复监听并检查

本地开发：

~~~bash
npm run market:watch:dev
~~~

测试环境用 `npm run market:watch:test`。本地保持终端运行，不要再启动第二个写入命令。

线上已有 PM2 进程：

~~~bash
pm2 restart chart-watch --update-env
pm2 save
pm2 status
pm2 logs chart-watch --lines 30 --nostream
curl -i http://127.0.0.1:3000/api/market/health
~~~

线上只恢复 PM2 的 `chart-watch`，不要同时手动执行 `npm run market:watch:prod`。首次部署、PM2 尚未登记进程时，应按前面的部署步骤启动，而不是直接使用上述 restart 命令。

监听从数据库保存的最后成功断点继续。首次使用新版代码时可能先自动备份并校正旧历史时间，等待日志完成；不会因为移走残留锁而重新全扫。健康接口正常追块时返回 200/`catching_up`，追到观测链头且探测正常后返回 200/`healthy`；过期/未就绪等异常仍为 503。恢复运行后重新出现 `.lock` 是正常的，不要再次移走。

## 数据库备份、下载与历史保留

`events` 按 `tx + logIndex` 唯一保存所有事件，K 线按 `interval + timestamp` 保存；历史不按 5 天或 24 小时清除。24h 指标只是查询窗口，不影响历史保留。
首页最多取每周期 120 根 K 线、25 条交易；分页通过索引查询。Worker 只更新新增事件、受影响的 K 线桶和小型行情头，不再每个区块重写全量历史。当前柱持续接收储备价，其历史极值也会保留。
单行事件/蜡烛用 JSON payload 保留原字段，另有索引列负责查询；不是把完整 market.json 存进一个数据库字段。

在线备份无需停止 watcher。在服务器执行：

~~~bash
cd /home/ubuntu/chart
npm run market:backup:prod
~~~

命令使用 SQLite 在线备份 API，包含已提交 WAL 数据，并通过 `PRAGMA integrity_check` 检查。输出备份文件的完整路径。也可用 `-- --to /备份目录/market-20261013.db` 指定新文件；已有目标一律拒绝覆盖。

在你自己的 Mac 终端下载（用上面实际输出的路径替换示例，按需加 `-i SSH密钥路径`）：

~~~bash
scp ubuntu@服务器公网IP:/备份文件实际路径/market-snapshot.db ~/Downloads/market-server-20261013.db
~~~

可用 SQLite 查看工具在本地打开快照。它不会自动跟随服务器更新；也可以把独立快照放到新服务器，并配置其 `MARKET_DATA_FILE`，从保存的断点继续。
**不要直接只下载正在运行的 `market.db`：WAL 模式还有 `-wal` / `-shm` 文件，部分已提交内容可能仍在 WAL 中。不要手动删除这些辅助文件。**
恢复时先停止 Web/Worker，将备份放到新的数据库路径，再调整 `MARKET_DATA_FILE` 并重启，避免旧 WAL 与恢复文件混用。
唯一数据库不能随意删除，否则历史与断点都会丢失。若以后明确要重扫，应先停 Web/Worker，备份现有库并换用新的空库路径，避免误清空仍在使用的文件。
数据和 WAL/SHM/备份均不随源码提交。请定期把备份下载到另一位置并监控磁盘；SQLite 解决访问方式，不会阻止永久历史占用更多磁盘。

## 接口与实时更新

| 路径 | 用途 |
| --- | --- |
| GET /api/market | 首屏精简快照，最近 K 线和交易；full=true 可读取完整历史，避免频繁调用 |
| GET /api/market/candles | interval、from、to、before、limit 分页读取 K 线，最多 2000 条原始柱 |
| GET /api/market/transactions | cursor、limit 分页读取交易，最多 200 条；afterBlock（排除）、throughBlock（包含）用于固定断线补数据窗口 |
| GET /api/market/stream | SSE 推送现价、储备、最近柱和事件；15 秒心跳 |
| GET /api/market/health | 只读新鲜度；healthy/catching_up 返回 200，其他状态 503；strict=1 时仅 healthy 返回 200，用于严格就绪监控 |

Web 服务只读。原 POST /api/market 已移除（返回 405），避免公网触发重建、多个进程覆盖文件或储备刷新推进历史断点。
同步和备份使用 CLI 命令。页面刷新按钮只重新读取行情，不直接写链或重新扫描。

浏览器 SSE 失败时退回每 10 秒请求快照，重连后恢复 SSE。历史分页保留已加载内容，失败后点击刷新可重试。
服务端同一进程一秒内共享有界 SQLite 查询结果。SSE 的 totalEvents 使用数据库累计计数，不会因只读最近 25 条而变成 25；SSE 仍只发最近两根柱和最近 25 条事件。
客户端发现累计新增交易超过实时包包含数量，或跨过两分钟的更新缺口，会分页补齐遗漏的交易和六周期 K 线。交易窗口固定到目标区块，游标必须前进；失败保留原状态并自动重试，不把失败当作“没有历史”。慢响应不能覆盖新修订；历史校正/重组后换代读取，不能把孤块与新主链合并。

“SSE 已连接”只说明浏览器与 Web 连接正常。独立新鲜度栏读取 `/api/market/health`（每 15 秒、回到前台立即检查），查看 Worker 最近成功 RPC 探测、链上区块时间、已扫断点和落后块数，不以最后一笔成交时间判断。默认探测或链时间超过 90 秒（配置轮询更慢时取三倍轮询间隔）、扫描报错/停止会提示过期；尚未追到观测高度显示追块。Web 不为每个用户直接发 RPC 请求；此接口可接外部监控，但不会自行发送短信/邮件告警。
正常追块不在页面额外显示“正在追块，落后 N 个区块”说明行，落后块数移到问号 Popover 内查看，避免追块/正常状态切换时撑动页面；真正过期、未就绪或监控不可用的警告仍保留。此调整只影响展示，不改变扫描或新鲜度判断。

交易列表的买卖记录同时显示 HUGE 成交数量、成交均价（NFX/HUGE）和成交 NFX 总额。
均价为该笔 Swap 的 NFX 数量 ÷ HUGE 数量；总额直接使用链上事件的 `quoteAmount`，不从四舍五入后的显示价格反算。
添加／移除流动性记录在成交量列显示两种代币数量，成交均价和成交额显示 `—`，避免把流动性操作误标为成交。
交易列表采用八列表格：时间、类型、成交均价、成交量、成交额、交易者、交易 Hash、块高。买入绿色、卖出红色、流动性蓝色，PC 表头固定、行背景交替。
“交易记录”旁的问号使用 shadcn/ui Popover，手机同样可用，键盘 Enter/空格可打开、Esc 或点击外部/关闭按钮可关闭。这里 NFX 的计价角色类似 USDT（U），但不表示等值或价格稳定；方向始终以 HUGE 为准：买入 HUGE 是付出/卖出 NFX，卖出 HUGE 是收到/买入 NFX。加减池子单独标记，不属于买卖。此说明不改变交易方向、价格或扫块数据。
PC 和移动端均点击 **交易 Hash** 在新标签页打开链上浏览器的 `/tx/完整Hash`，时间仅用于显示，不再是链接。Hash 缩略展示，悬停可看完整值；块高使用原始 `blockNumber`，缺失显示 `—`。两项均来自已有事件，不改扫块、不需要回扫。
移动端保留全部列并支持列表内部横向滑动，交易者地址点击复制；复制成功状态只影响对应的一条记录。
移动端交易列表不再限制纵向高度：手指从列表内上下滑动时滚动整个页面，页面接近列表底部时自动加载更早记录；PC 保留列表内部滚动。
页面顶部 header 提供 `0x / hg` 开关，默认 `hg`，统一控制交易列表地址显示和复制格式。
选择保存在浏览器 `localStorage`（`chart-transaction-address-type`），刷新或关闭后再打开仍保留；更换浏览器／设备或清除网站数据后恢复默认。无痕模式或存储不可用时仅在当前页面生效。
复制的是当前格式的完整地址。
该功能沿用 Swap 项目的 `hg` Bech32 编码方式（20 字节账户地址）。只转换交易者的展示／复制，不修改 API、扫块和数据库中的原始地址，LP 地址也保持不变。

## K 线口径和当前限制

支持 1m / 5m / 15m / 1h / 4h / 1d。连续展示时无交易周期补上一收盘价、成交量为零；下一根展示开盘价接上一根收盘价，高低价包含这个开盘价。
这与“第一笔成交价作为开盘价”口径不同，原始交易和数据库不被前端改写。
当前价格使用池子储备 NFX/HUGE；最新柱收盘价与价格卡片统一。

### 全宽布局与图表指标

参考 [AVE 行情页](https://ave.ai/token/0x5a0ee0f97969f1a2c6ff8774021c6370d04a830c-bsc) 的紧凑终端和分隔条交互，不复制其交易、钱包登录或未接入的数据功能。

桌面端（宽度 ≥ 1024px）整个终端框架固定在窗口内：Header、右侧 LP 信息栏和底栏不随左侧移动，页面本身不纵向滚动。K 线与交易区共用左侧 `.terminal-panels` 内部滚动容器。图表默认 **720px**，交易区固定 **640px**；两者高度独立，拉高图表只增加左侧内部可滚动内容，不会压缩交易区。交易行恢复原来的 46px 高度与上下 9px 内边距（实际行高受按钮内容影响约 49px），不使用紧凑行。交易列表内部滚动并触底分页，滚到边缘可继续滚动左侧主区；右侧内容过长时只在右栏内部滚动。手机保留原来的页面纵向滚动，不套用桌面锁屏规则。

数据源与最新区块状态栏固定在窗口底部，手机端包含安全区；页面底部预留同等空间，不遮住交易内容。

左侧主区、右栏、交易列表与指标栏统一使用低对比细滚动条：透明轨道，悬停或键盘聚焦时加强颜色，不完全隐藏滚动提示；滚动容器、分页和手机手势保持不变。使用标准 scrollbar 属性，并为较旧 WebKit 浏览器提供 6px 圆角样式。

图表下方分隔条只调整图表高度（480–2000px）；方向键每次 20px，Shift + 方向键每次 100px，双击恢复 720px。使用现有 shadcn Button 提供可聚焦分隔条，独立拖拽逻辑在 `hooks/use-chart-height.ts`，不再使用会按比例挤压另一面板的 ResizableGroup，也没有新增第三方依赖。高度保存到浏览器 localStorage 的 `chart-terminal-height-v2`，旧的比例偏好不读取。拖动期间临时保护 iframe 的指针事件，释放、取消或失焦后恢复，正常看图不加遮罩。

桌面行情新鲜度合并到顶栏，图表标题/周期、交易标题/筛选各共用一行；原生 TradingView 工具保留。手机仍按图表→交易对→交易记录顺序展示，不显示拖拽分隔条，交易列表按内容展开并使用页面视口分页，保留原有页面滚动。通过 CSS 重排同一套 DOM，跨屏幕断点不销毁图表和列表。布局修改无需重扫链，构建并重启 Web 即可。

配色使用原来的深蓝黑主题：页面底色 `#060a0f`，K 线与主面板背景 `#0b1118`，保留原有渐变、表头与交替行配色。买入/上涨为绿，卖出/下跌为红，流动性与 Hash 链接为蓝色；代币 Logo 和指标线颜色不变。全局主题变量位于 `app/globals.css` 的 `:root`。已保存的黑色图表布局加载后会恢复原背景和刻度文字颜色，不清除指标或画线。

图表直接提供 `VOL / MA / EMA / BOLL / MACD / RSI / KD / StochRSI / CCI / WR / ATR / OBV / SAR` 快捷入口，手机可左右滑动指标栏，“更多”保留原生完整选择器：

- 默认只显示 VOL 独立副图，高度约 90px；MA 默认关闭，手动开启为 5/10/20；EMA 默认关闭，开启后为 12/26。
- 旧版图表偏好会进行一次默认值更新：移除旧的 MA、把 VOL 缩至 90px，保留其他指标、画线和参数。保存后记录 defaultsVersion=2；此后手动开启 MA 或调整副图高度会正常持久化，不会每次刷新被覆盖。关闭再开启 VOL 时重新使用较矮的默认副图高度。
- VOL 的单位为 **NFX**，表示每根柱内 Swap 的 NFX 成交额（不是 HUGE 数量，也不是 USD）；加减池子和 Sync 不计入成交量。无交易周期为零。
- 所有指标由 TradingView 根据当前展示 K 线计算，切换周期后按新周期重算。在图内指标设置中可修改参数、颜色。除 MA/EMA 的上述周期外，其他快捷指标使用当前库的原生默认参数，不默认全部开启。
- BOLL 是布林带、KD 是原生 Stochastic 的 K/D 两条线（**不是三线 KDJ**），StochRSI 是随机 RSI；OBV 使用本数据源的 NFX 成交额作为 volume。指标列表可参考 [TradingView 原生指标说明](https://www.tradingview.com/charting-library-docs/latest/ui_elements/indicators/Indicators-List/)。运行时以当前库 `getStudiesList()` 返回的名称为准，不支持的入口会明确提示，不影响行情。
- 指标、参数、画线、面板布局保存在当前浏览器的 localStorage，按链 ID 与 LP 地址隔离；刷新后恢复，主动删除的指标不会被默认项强行补回。关闭再开启快捷指标会重新使用默认周期。K 线首次打开默认日线（1D）；顶部周期使用单独的偏好，用户手动选择后刷新优先恢复所选周期，没有有效偏好时回退日线。
- 这只是图表设置持久化，不是离线行情缓存；换浏览器/设备或清除站点数据会丢失偏好，隐私模式或存储配额不足时图表仍能使用，但设置可能无法保存。若旧布局不兼容导致图表失败，可使用错误提示中的“清除本机图表设置并重试”，只清除当前池子的本机指标/画线/面板设置，不删除行情；普通重试不清除设置。

**已存在 SQLite 数据库的成交量升级：** 正常更新代码、构建并重启 `chart-watch` 即可。Worker 在持有写入锁后，会先生成一个包含 WAL 的独立 `.db.backup-*.db` 备份，再从已有 Swap 事件一次性重算六个周期的 volume/trades。只改这两个派生字段，保留 OHLC、全部事件、交易者和 lastBlock；不请求 RPC 重新扫历史。修复事务失败会整体回滚，成功后记录版本，后续重启不重复扫描历史。请预留备份和 WAL 所需磁盘空间，不要删除数据库。新建数据库直接采用正确口径。

本地若已经运行旧版 `npm run market:watch:dev`，先在该终端按 `Ctrl+C`，再运行同一命令；仅热更新前端不会更新独立的 Worker。升级后刷新浏览器，让历史 K 线重新读取修正后的成交量。

主要模块：`components/market/chart-indicators.tsx` 负责指标按钮；`utils/tradingview-indicators.ts` 集中定义指标名称/别名/位置；`utils/tradingview-preferences.ts` 负责原生指标及偏好保存；`lib/market/volume-maintenance.mjs` 负责旧库成交量修复；`app/globals.css` 的 terminal-grid 定义桌面分栏与移动端顺序。

手机端已移除图表外额外的“最新 K 线”开、高、低、收栏及对应组件/样式，不额外占用页面高度。TradingView 图内自带图例保留，长按历史蜡烛可查看该柱信息；不改变行情、K 线数据或指标计算。
移动端默认收起 OHLC 的行为见 [TradingView 移动端说明](https://www.tradingview.com/charting-library-docs/latest/mobile_specifics/)。本次布局调整保留横向拖图、双指缩放和桌面鼠标操作，不增加图内自定义 OHLC 浮层。

所有浏览器统一使用 TradingView 的 `iframe_loading_compatibility_mode`，以 `about:blank` 替代默认的 `blob:` iframe，不靠 UA 判断手机（覆盖 iPad 桌面 UA 和内嵌浏览器）。数据源配置/历史回调异步执行；历史请求先读完时间窗口及前置柱，不把最近 120 根的部分缓存当成完整历史。脚本下载、K 线分页请求设置 25 秒超时，图表初始化设置 45 秒超时。失败时图表区域会显示初始化/交易对/数据加载的具体阶段和“重新加载图表”按钮，无需重载整个页面。
图表卸载、重试和开发热更新时只清理当前 effect 创建的实例：先停止请求/回调、释放本地定时器与 pagehide 监听，再逐项取消实际建立的原生订阅，最后移除 widget。清理可重复调用，iframe 已销毁导致 unsubscribe/remove 失败也不会中断其余清理；初始化中途失败的部分订阅同样可释放，不删除图表偏好或行情数据。
该模式与异步回调的说明见 [TradingView 故障排查](https://www.tradingview.com/charting-library-docs/latest/troubleshooting/) 和 [Datafeed API](https://www.tradingview.com/charting-library-docs/latest/connecting_data/datafeed-api/)。

K 线禁用 `vert_touch_drag_scroll`，普通纵向触摸交给页面滚动；横向拖动历史 K 线、双指缩放及 PC 鼠标操作仍保留。长按进入十字光标等图表交互时可能仍由图表处理，轻点退出后恢复普通滑动。
对应设置见 [TradingView 触摸滚动配置](https://www.tradingview.com/charting-library-docs/latest/customization/Featuresets/#vert_touch_drag_scroll)。

准确性边界：时间与哈希依赖配置 RPC 的正确性；最新区块可能尚未最终确认，发现重组后修正，不宣称不可逆。旧库时间校正不等于对历史每条日志内容进行独立审计。K 线仍保留上文连续展示/储备现价与成交价的既有口径，不是纯逐笔成交 OHLC；价格采用 JavaScript 数值用于展示，不用于结算。
兼容性验收：本次生产构建在内置浏览器已验证 K 线绘制、原生 VOL/MA/EMA 和周期切换，修复此前初始化超时；移动尺寸测试不能替代真实 iOS Safari、安卓 Chrome 和微信 WebView 的真机长按/缩放/滚动验收。

## 检查命令

~~~bash
npx tsc --noEmit
npm run lint
npm run test:market
npm run test:ui
npm run build
~~~
