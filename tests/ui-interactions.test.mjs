import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { JSDOM } from "jsdom";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

// 在加载 Radix/ReactDOM 前建立 DOM，测试真实原语而不是模拟 Popover 的开关逻辑。
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
const previous = new Map();
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "DocumentFragment", "CustomEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  const value = dom.window[name];
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === "function" && ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(name) ? value.bind(dom.window) : value });
}
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = dom.window.ResizeObserver = ResizeObserverStub;
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const require = createRequire(import.meta.url);
const { render, screen, cleanup, waitFor, within } = require("@testing-library/react");
const { act } = require("@testing-library/react");
const userEvent = require("@testing-library/user-event").default;
const h = React.createElement;

afterEach(() => { cleanup(); dom.window.localStorage.clear(); });
after(() => {
  dom.window.close();
  delete globalThis.ResizeObserver;
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

test("真实 Popover 通过 Portal 打开，说明完整，Esc/外部点击/关闭按钮可关闭并正确恢复焦点", async () => {
  const { TransactionDirectionHelp } = loadTypeScript("components/market/transaction-direction-help.tsx");
  const user = userEvent.setup({ document: dom.window.document });
  const { container } = render(h("section", { style: { overflow: "hidden" } }, h(TransactionDirectionHelp), h("button", null, "外部按钮")));
  const trigger = screen.getByRole("button", { name: "买卖方向说明", exact: true });
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(screen.queryByRole("dialog"), null);
  await user.click(trigger);
  let dialog = screen.getByRole("dialog", { name: "买卖方向说明", exact: true });
  assert.equal(container.contains(dialog), false, "Portal 不在 overflow:hidden 的列表卡片内部");
  assert.ok(document.body.contains(dialog));
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  for (const text of ["作用类似交易对中的 USDT（U）", "买卖方向以 HUGE 为准", "付出 NFX，获得 HUGE，相当于卖出 NFX", "付出 HUGE，获得 NFX，相当于买入 NFX", "不代表 NFX 与 USDT 等值或价格稳定", "加减池子不属于买卖"]) assert.ok(dialog.textContent.includes(text));
  await user.keyboard("{Escape}");
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  assert.equal(document.activeElement, trigger);
  await user.keyboard("{Enter}");
  dialog = screen.getByRole("dialog", { name: "买卖方向说明", exact: true });
  await user.click(within(dialog).getByRole("button", { name: "关闭买卖方向说明" }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  assert.equal(document.activeElement, trigger);
  await user.keyboard(" ");
  assert.ok(screen.getByRole("dialog"));
  await user.click(screen.getByRole("button", { name: "外部按钮" }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  const css = fs.readFileSync("app/globals.css", "utf8");
  assert.match(css, /width:\s*min\(360px, calc\(100vw - 24px\)\)/);
  assert.match(css, /max-height:\s*var\(--radix-popover-content-available-height\)/);
});

test("地址 ToggleGroup 保留单选、点击已选项不清空、键盘切换与本地持久化", async () => {
  const { MarketHeader } = loadTypeScript("components/market/market-header.tsx");
  const { useAddressConvert } = loadTypeScript("hooks/use-address-convert.ts");
  const user = userEvent.setup({ document: dom.window.document });
  function Harness() {
    const { addressType, changeAddressType } = useAddressConvert();
    return h(MarketHeader, { streamStatus: "connected", addressType, onAddressTypeChange: changeAddressType });
  }
  const view = render(h(Harness));
  const hg = screen.getByRole("radio", { name: "hg 地址" });
  const hex = screen.getByRole("radio", { name: "0x 地址" });
  assert.equal(hg.getAttribute("aria-checked"), "true");
  await user.click(hg);
  assert.equal(hg.getAttribute("aria-checked"), "true");
  await user.click(hex);
  assert.equal(hex.getAttribute("aria-checked"), "true");
  assert.equal(dom.window.localStorage.getItem("chart-transaction-address-type"), "0x");
  await user.keyboard("{ArrowRight}{Enter}");
  assert.equal(hg.getAttribute("aria-checked"), "true");
  await user.click(hex);
  view.unmount(); render(h(Harness));
  await waitFor(() => assert.equal(screen.getByRole("radio", { name: "0x 地址" }).getAttribute("aria-checked"), "true"));
});

test("交易 Tabs 支持鼠标/键盘筛选，保持八列表格、Hash、原列表根与加载标记", async () => {
  const { TransactionsPanel } = loadTypeScript("components/market/transactions-panel.tsx");
  const user = userEvent.setup({ document: dom.window.document });
  let resetCount = 0;
  const listRef = React.createRef(), loadMoreRef = React.createRef();
  const row = { tx: `0x${"b".repeat(64)}`, wallet: `0x${"a".repeat(40)}`, time: "2026-10-13T03:00:00Z", logIndex: 1, blockNumber: 749201, side: "Buy", price: 1800, baseAmount: 2, quoteAmount: 3600 };
  function Harness() {
    const [transactionFilter, setTransactionFilter] = React.useState("all");
    const model = { transactionFilter, setTransactionFilter, setVisibleCount: (count) => { resetCount++; assert.equal(count, 20); },
      fetchMarket: async () => {}, listRef, loadMoreRef, visibleTransactions: transactionFilter === "liquidity" ? [] : [row],
      transactions: [row], visibleCount: 20, transactionHasMore: true, explorerUrl: "https://scan.interstellarchain.org", markAddressCopied: async () => {} };
    return h(TransactionsPanel, { model, addressType: "0x" });
  }
  render(h(Harness));
  const root = listRef.current;
  assert.equal(screen.getAllByRole("columnheader").length, 8);
  assert.ok(root.contains(loadMoreRef.current));
  assert.ok(screen.getByRole("link", { name: `在区块浏览器查看交易 ${row.tx}` }).href.endsWith(`/tx/${row.tx}`));
  await user.click(screen.getByRole("tab", { name: "买卖", exact: true }));
  assert.equal(screen.getByRole("tab", { name: "买卖", exact: true }).getAttribute("aria-selected"), "true");
  await user.keyboard("{ArrowRight}");
  await waitFor(() => assert.equal(screen.getByRole("tab", { name: "流动性", exact: true }).getAttribute("aria-selected"), "true"));
  assert.ok(screen.getByText("暂无交易记录"));
  assert.equal(listRef.current, root, "切换筛选不重建列表滚动根");
  assert.ok(root.contains(loadMoreRef.current));
  assert.ok(resetCount >= 2);
  assert.equal(root.querySelector("table").parentElement.className, "relative w-full overflow-visible", "不创建额外滚动范围");
});

test("指标使用真实 Toggle/Tooltip，独立切换，忙碌状态禁止重复提交", async () => {
  const { ChartIndicators } = loadTypeScript("components/market/chart-indicators.tsx");
  const { TooltipProvider } = loadTypeScript("components/ui/tooltip.tsx");
  const { EMPTY_INDICATORS } = loadTypeScript("utils/tradingview-preferences.ts");
  const user = userEvent.setup({ document: dom.window.document });
  const changed = [];
  function Harness({ busy = false }) {
    const [state, setState] = React.useState({ ...EMPTY_INDICATORS, VOL: true, MA: true, busy: false });
    return h(TooltipProvider, { delayDuration: 0 }, h(ChartIndicators, {
      state: { ...state, busy }, onMore: () => changed.push("more"), onToggle: (group) => {
        changed.push(group); setState((current) => ({ ...current, [group]: !current[group] }));
      },
    }));
  }
  const view = render(h(Harness));
  const macd = screen.getByRole("button", { name: "MACD", exact: true });
  assert.equal(macd.getAttribute("aria-pressed"), "false");
  await user.hover(macd);
  assert.ok((await screen.findByRole("tooltip")).textContent.includes("平滑异同移动平均线"));
  await user.click(macd);
  assert.equal(macd.getAttribute("aria-pressed"), "true");
  assert.equal(screen.getByRole("button", { name: "MA", exact: true }).getAttribute("aria-pressed"), "true");
  await user.click(macd); assert.equal(macd.getAttribute("aria-pressed"), "false");
  await user.click(screen.getByRole("button", { name: "更多" }));
  assert.deepEqual(changed, ["MACD", "MACD", "more"]);
  view.rerender(h(Harness, { busy: true }));
  assert.equal(macd.disabled, true);
  await user.click(macd); assert.deepEqual(changed, ["MACD", "MACD", "more"]);
});

test("实际 dashboard hook 串行补齐 425 笔漏单，历史换代清除孤块，卸载取消订阅", async () => {
  const at = (seconds) => new Date(seconds * 1000).toISOString();
  const event = (number) => ({ tx: `0x${number.toString(16).padStart(64, "0")}`, blockNumber: number, logIndex: 0, kind: "swap", side: "Buy", timestamp: 1_800_000_000 + number, time: at(1_800_000_000 + number), wallet: "", price: 100, baseAmount: 1, quoteAmount: 100 });
  const snapshot = (block, total, epoch, revision) => ({
    metadata: { updatedAt: at(1_800_000_000 + block), pair: "HUGE / NFX" }, quote: { priceQuote: 100, change24h: 0 }, metrics: [],
    pool: { lastBlock: block, reserves: { base: 1, quote: 100 } }, transactions: [], candles: [], candlesByInterval: {},
    history: { lastBlock: block, lastSyncAt: at(1_800_000_000 + block), totalEvents: total, datasetVersion: epoch, revision,
      events: Array.from({ length: Math.min(total, 25) }, (_, index) => event(block - index)), transactionsCursor: "older" },
  });
  let latest = snapshot(25, 25, "a", 1), handlers, model, unsubscribed = false;
  const pages = [];
  const client = {
    fetchMarketSnapshot: async () => latest,
    subscribeMarketStream: (value) => { handlers = value; return () => { unsubscribed = true; }; },
    fetchTransactionPage: async (options) => {
      pages.push(options);
      const top = options.cursor ? Number(options.cursor) : options.throughBlock;
      const items = Array.from({ length: Math.min(200, top - options.afterBlock) }, (_, index) => event(top - index));
      const hasMore = top - items.length > options.afterBlock;
      return { items, lastBlock: latest.history.lastBlock, datasetVersion: "a", page: { hasMore, nextCursor: hasMore ? String(top - items.length) : null } };
    },
    fetchCandlePage: async () => ({ items: [], datasetVersion: "a", page: { hasMore: false, nextCursor: null } }),
  };
  const { useMarketDashboard } = loadTypeScript("hooks/use-market-dashboard.ts", {
    "@/lib/market-client": client,
    "@/hooks/use-market-health": { useMarketHealth: () => null },
    "@/utils/transaction-pagination": { observeTransactionPagination: () => () => {} },
  });
  function Harness() { model = useMarketDashboard(); return h("span", null, model.market?.history?.lastBlock ?? "loading"); }
  const view = render(h(React.StrictMode, null, h(Harness)));
  await waitFor(() => assert.equal(model.market?.history?.lastBlock, 25));
  latest = snapshot(450, 450, "a", 2);
  await act(async () => handlers.onUpdate({ type: "market:update", metadata: latest.metadata, pool: latest.pool, quote: latest.quote, metrics: latest.metrics, history: latest.history, candlesByInterval: {} }));
  await waitFor(() => assert.equal(model.market?.history?.lastBlock, 450));
  assert.equal(model.market.history.events.length, 450);
  assert.equal(pages.length, 3);
  latest = snapshot(20, 20, "b", 3);
  await act(async () => handlers.onUpdate({ type: "market:update", metadata: latest.metadata, pool: latest.pool, quote: latest.quote, history: latest.history, candlesByInterval: {} }));
  await waitFor(() => assert.equal(model.market?.history?.datasetVersion, "b"));
  assert.equal(model.market.history.lastBlock, 20);
  assert.equal(model.market.history.events.length, 20);
  assert.ok(model.market.history.events.every((item) => item.blockNumber <= 20));
  view.unmount();
  assert.equal(unsubscribed, true);
});

test("SSE 已连接仍独立显示过期警告及区块落后信息", async () => {
  const { MarketFreshness } = loadTypeScript("components/market/market-freshness.tsx");
  const { MarketHeader } = loadTypeScript("components/market/market-header.tsx");
  const user = userEvent.setup({ document: dom.window.document });
  render(h(React.Fragment, null, h(MarketHeader, { streamStatus: "connected", addressType: "hg", onAddressTypeChange() {} }),
    h(MarketFreshness, { recovering: false, health: { status: "stale", reason: "链上行情更新中断", observedBlock: 100, indexedBlock: 80, lagBlocks: 20, checkedAt: "2026-10-13T00:00:00Z" } })));
  assert.ok(screen.getByText("SSE 已连接"));
  assert.ok(screen.getByRole("status").textContent.includes("行情可能已过期"));
  assert.equal(screen.queryByText("落后 20 块"), null);
  await user.click(screen.getByRole("button", { name: "查看行情新鲜度说明" }));
  assert.ok(screen.getByRole("dialog").textContent.includes("不代表后台已追到最新区块"));
  assert.ok(within(screen.getByRole("dialog")).getByText("落后 20 块"));
});

test("正常追块不新增警告行或落后计数，切换正常状态保持相同页面结构，详情仍可查询", async () => {
  const { MarketFreshness } = loadTypeScript("components/market/market-freshness.tsx");
  const user = userEvent.setup({ document: dom.window.document });
  const health = { status: "catching_up", reason: "正在追块，落后 2 个区块", observedBlock: 102, indexedBlock: 100, lagBlocks: 2 };
  const view = render(h(MarketFreshness, { recovering: false, health }));
  const region = screen.getByRole("region", { name: "行情新鲜度" });
  const children = Array.from(region.children);
  assert.equal(region.querySelector(".freshness-warning"), null);
  assert.equal(screen.queryByText(health.reason), null);
  assert.equal(screen.queryByText("落后 2 块"), null);
  view.rerender(h(MarketFreshness, { recovering: false, health: { ...health, status: "healthy", lagBlocks: 0, reason: "行情同步正常" } }));
  assert.deepEqual(Array.from(region.children), children, "不增删页面行或替换状态栏节点");
  view.rerender(h(MarketFreshness, { recovering: false, health }));
  await user.click(screen.getByRole("button", { name: "查看行情新鲜度说明" }));
  assert.ok(within(screen.getByRole("dialog")).getByText("落后 2 块"));
});
