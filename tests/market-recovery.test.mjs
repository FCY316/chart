import test from "node:test";
import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { needsMarketRecovery, recoverMarketGap, isOlderMarket } = loadTypeScript("utils/market-recovery.ts");
const { mergeMarketStreamUpdate } = loadTypeScript("utils/market.ts");
const at = (seconds) => new Date(seconds * 1000).toISOString();
const candle = (timestamp, close = 100) => ({ timestamp, time: at(timestamp), open: 100, high: Math.max(100, close), low: Math.min(100, close), close, volume: 10 });
const event = (blockNumber) => ({ tx: `0x${blockNumber.toString(16).padStart(64, "0")}`, blockNumber, logIndex: 0, timestamp: 1_800_000_000 + blockNumber, time: at(1_800_000_000 + blockNumber), kind: "swap", side: "Buy", baseAmount: 1, quoteAmount: 100, price: 100, wallet: "0x123" });
const base = () => ({
  metadata: { updatedAt: at(1_800_000_000), pair: "HUGE / NFX" }, quote: { priceQuote: 100 }, metrics: [],
  pool: { lastBlock: 25 }, history: { lastBlock: 25, lastSyncAt: at(1_800_000_000), totalEvents: 25, datasetVersion: "a", revision: 1, events: [event(25)] },
  candles: [], candlesByInterval: { "1m": [candle(1_800_000_000)] }, transactions: [],
});
const update = () => ({ type: "market:update", metadata: { updatedAt: at(1_800_000_120) }, quote: { priceQuote: 120 }, metrics: [{ label: "累计交易", value: "450" }],
  pool: { lastBlock: 450 }, history: { lastBlock: 450, lastSyncAt: at(1_800_000_120), totalEvents: 450, datasetVersion: "a", revision: 2, events: Array.from({ length: 25 }, (_, index) => event(426 + index)) },
  candlesByInterval: { "1m": [candle(1_800_000_060, 110), candle(1_800_000_120, 120)] },
});

test("实时包完整且没有跨时间缺口不补页，超过 25 条或长时间断线必须补", () => {
  const incoming = update();
  assert.equal(needsMarketRecovery(base(), incoming), true);
  const complete = { ...incoming, metadata: { updatedAt: at(1_800_000_001) }, history: { ...incoming.history, lastBlock: 26, totalEvents: 26, events: [event(26)] } };
  assert.equal(needsMarketRecovery(base(), complete), false);
  assert.equal(needsMarketRecovery(base(), { ...complete, metadata: incoming.metadata }), true);
});

test("补齐超过 200 笔交易与多页 K 线，只合并同代数据并同步指标卡片", async () => {
  const calls = [], candleCalls = [];
  const next = await recoverMarketGap(base(), update(), new AbortController().signal, {
    transactions: async (options) => {
      calls.push(options);
      const pageNumber = options.cursor ? Number(options.cursor) : 0;
      const events = Array.from({ length: pageNumber < 2 ? 200 : 25 }, (_, index) => event(450 - pageNumber * 200 - index));
      return { items: events, datasetVersion: "a", page: { hasMore: pageNumber < 2, nextCursor: String(pageNumber + 1) } };
    },
    candles: async (options) => {
      candleCalls.push(options);
      const more = options.interval === "1m" && options.before > 1_800_000_060;
      return { items: [candle(more ? 1_800_000_060 : 1_800_000_000)], datasetVersion: "a", page: { hasMore: more, nextCursor: more ? 1_800_000_060 : null } };
    },
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((item) => item.afterBlock === 25 && item.throughBlock === 450 && item.limit === 200));
  assert.equal(new Set(next.history.events.map((item) => item.tx)).size, 426);
  assert.equal(next.history.lastBlock, 450);
  assert.equal(next.candlesByInterval["1m"].at(-1).close, 120);
  assert.equal(next.metrics[0].value, "450");
  assert.ok(candleCalls.some((item) => item.before === 1_800_000_060));
});

test("补页期间校正/重组或重复游标拒绝提交，不把不同历史拼在一起", async () => {
  const previous = base(), unchanged = structuredClone(previous);
  const loaders = { transactions: async () => ({ items: [], datasetVersion: "b", page: { hasMore: false } }), candles: async () => { throw new Error("不应请求"); } };
  await assert.rejects(recoverMarketGap(previous, update(), new AbortController().signal, loaders), /历史已校正/);
  assert.deepEqual(previous, unchanged);
  loaders.transactions = async () => ({ items: [], datasetVersion: "a", page: { hasMore: true, nextCursor: "same" } });
  await assert.rejects(recoverMarketGap(previous, update(), new AbortController().signal, loaders), /游标未前进/);
});

test("修订号防止慢响应覆盖；重组的新修订允许高度降低并触发换代读取", () => {
  const current = { ...base(), history: { ...base().history, revision: 10 } };
  assert.equal(isOlderMarket(current, { history: { revision: 9, lastBlock: 1000 } }), true);
  assert.equal(isOlderMarket(current, { history: { revision: 11, lastBlock: 20, datasetVersion: "new" } }), false);
  assert.equal(mergeMarketStreamUpdate(current, update()), current);
});

test("健康接口正常追块返回 200 且保留落后状态，严格检查和真正异常仍返回 503", async () => {
  let health = { status: "catching_up", reason: "正在追块，落后 2 个区块", lagBlocks: 2 };
  const { GET } = loadTypeScript("app/api/market/health/route.ts", {
    "@/lib/market/config.mjs": { getMarketConfig: () => ({}) },
    "@/lib/market/health.mjs": { readMarketHealth: async () => health },
  });
  const normal = await GET(new Request("http://localhost/api/market/health"));
  assert.equal(normal.status, 200);
  assert.equal(normal.headers.get("cache-control"), "no-store");
  assert.deepEqual(await normal.json(), health, "不把正在追块伪装成已追平");
  assert.equal((await GET(new Request("http://localhost/api/market/health?strict=1"))).status, 503);
  for (const status of ["healthy", "stale", "unknown", "unready"]) {
    health = { ...health, status };
    for (const query of ["", "?strict=1"]) {
      const response = await GET(new Request(`http://localhost/api/market/health${query}`));
      assert.equal(response.status, status === "healthy" ? 200 : 503);
      assert.equal((await response.json()).status, status);
    }
  }
});

test("健康接口数据库读取失败仍返回 503，不向公网暴露内部错误", async () => {
  const { GET } = loadTypeScript("app/api/market/health/route.ts", {
    "@/lib/market/config.mjs": { getMarketConfig: () => ({}) },
    "@/lib/market/health.mjs": { readMarketHealth: async () => { throw new Error("private database path"); } },
  });
  const response = await GET(new Request("http://localhost/api/market/health"));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, "unready");
  assert.equal(body.reason, "行情数据库暂不可读");
  assert.ok(!JSON.stringify(body).includes("private database path"));
});
