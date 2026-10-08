import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);

// 仅测试配置与分页观察器，不代替真机手势验证，不运行浏览器自动化。
function loadTypeScript(file, overrides = {}) {
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (name) => {
    if (overrides[name]) return overrides[name];
    if (!name.startsWith("@/")) return require(name);
    const base = path.resolve(name.slice(2));
    return loadTypeScript([".ts", ".tsx"].map((extension) => base + extension).find((file) => fs.existsSync(file)), overrides);
  };
  new Function("require", "module", "exports", code)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

test("手机分页按页面视口观察，桌面及旋转屏幕后按正确根节点观察", (t) => {
  const previousWindow = globalThis.window;
  const previousObserver = globalThis.IntersectionObserver;
  t.after(() => { globalThis.window = previousWindow; globalThis.IntersectionObserver = previousObserver; });
  let listener;
  const query = { matches: true, addEventListener: (_type, callback) => { listener = callback; }, removeEventListener: (_type, callback) => { assert.equal(callback, listener); listener = null; } };
  globalThis.window = { matchMedia: (media) => { assert.equal(media, "(max-width: 759px)"); return query; } };
  const observers = [];
  globalThis.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; this.disconnected = false; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  };
  const { observeTransactionPagination } = loadTypeScript("utils/transaction-pagination.ts");
  const list = {}, sentinel = {};
  let loads = 0;
  const dispose = observeTransactionPagination(list, sentinel, () => { loads += 1; });
  assert.equal(observers[0].options.root, null);
  assert.equal(observers[0].target, sentinel);
  observers[0].callback([{ isIntersecting: false }]);
  assert.equal(loads, 0);
  observers[0].callback([{ isIntersecting: true }]);
  assert.equal(loads, 1);
  query.matches = false; listener();
  assert.equal(observers[0].disconnected, true);
  assert.equal(observers[1].options.root, list);
  query.matches = true; listener();
  assert.equal(observers[1].disconnected, true);
  assert.equal(observers[2].options.root, null);
  dispose();
  assert.equal(observers[2].disconnected, true);
  assert.equal(listener, null);
});

test("实际图表配置仅释放纵向触摸，保留横向拖图、缩放和鼠标操作", async (t) => {
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(() => {
    globalThis.window = previousWindow;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  });
  for (const userAgent of ["iPhone Mobile", "Android Mobile", "Desktop"]) {
    let options;
    let refCount = 0;
    const effects = [];
    const fakeReact = {
      useCallback: (callback) => callback,
      useState: (initial) => [initial, () => {}],
      useRef: (initial) => ({ current: ++refCount === 1 ? {} : initial }),
      useEffect: (callback) => { effects.push(callback); },
    };
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent } });
    globalThis.window = {
      setTimeout: () => 1, clearTimeout: () => {},
      TradingView: { widget: class {
        constructor(config) { options = config; }
        onChartReady(callback) { callback(); }
        remove() {}
      } },
    };
    const { TradingViewChart } = loadTypeScript("components/tradingview-chart.tsx", {
      react: fakeReact,
      "@/utils/tradingview-loader": { loadTradingViewLibrary: () => Promise.resolve() },
      "@/lib/market-client": { fetchCandlePage: () => { throw new Error("本测试不应请求行情"); } },
    });
    TradingViewChart({ candlesByInterval: {}, interval: "5m", currentPrice: 1800, updatedAt: "2026-10-08T00:00:00.000Z" });
    const cleanups = effects.slice(0, 3).map((effect) => effect());
    await Promise.resolve();
    assert.ok(options.disabled_features.includes("vert_touch_drag_scroll"));
    for (const feature of ["horz_touch_drag_scroll", "pinch_scale", "pressed_mouse_move_scroll", "mouse_wheel_scale"]) assert.ok(!options.disabled_features.includes(feature));
    assert.equal(options.enabled_features.includes("iframe_loading_compatibility_mode"), userAgent !== "Desktop");
    assert.equal(options.overrides["paneProperties.legendProperties.showSeriesOHLC"], true);
    for (const cleanup of cleanups) cleanup?.();
  }
});

test("手机最新柱 OHLC 与图表补柱相同，实时价格和周期切换生效，不改原始数据", () => {
  const { CandleOhlc } = loadTypeScript("components/market/candle-ohlc.tsx");
  const candles = [
    { time: "2026-10-08T00:00:00.000Z", open: 100, high: 115, low: 95, close: 110, volume: 1 },
    { time: "2026-10-08T00:05:00.000Z", open: 120, high: 123, low: 118, close: 121, volume: 2 },
  ];
  const original = JSON.stringify(candles);
  const props = { candles, interval: "5m", currentPrice: 125.1234, updatedAt: "2026-10-08T00:06:00.000Z" };
  const values = (html) => [...html.matchAll(/<dd>(.*?)<\/dd>/g)].map((match) => match[1]);
  const html = renderToStaticMarkup(CandleOhlc(props));
  assert.match(html, /最新 K 线 · 5m/);
  assert.match(html, /NFX \/ HUGE/);
  assert.deepEqual(values(html), ["110", "125.12", "110", "125.12"]);
  assert.deepEqual(values(renderToStaticMarkup(CandleOhlc({ ...props, currentPrice: 108 }))), ["110", "123", "108", "108"]);
  assert.deepEqual(values(renderToStaticMarkup(CandleOhlc({ ...props, updatedAt: "2026-10-08T00:11:00.000Z" }))), ["121", "125.12", "121", "125.12"]);
  const hourly = [{ ...candles[0], open: 90, high: 140, low: 80 }];
  const hourHtml = renderToStaticMarkup(CandleOhlc({ ...props, candles: hourly, interval: "1h" }));
  assert.match(hourHtml, /最新 K 线 · 1h/);
  assert.deepEqual(values(hourHtml), ["90", "140", "80", "125.12"]);
  assert.deepEqual(values(renderToStaticMarkup(CandleOhlc({ ...props, candles: [] }))), ["—", "—", "—", "—"]);
  assert.equal(JSON.stringify(candles), original);
});

test("手机表格无独立纵向滚动范围，所有六列仍可横向查看", () => {
  const css = fs.readFileSync("app/globals.css", "utf8");
  const mobile = css.slice(css.indexOf("@media (max-width: 759px)"));
  assert.match(mobile, /\.transaction-list\s*\{[^}]*max-height:\s*none/);
  assert.match(mobile, /\.transaction-list\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(mobile, /\.transaction-list\s*\{[^}]*overflow-y:\s*hidden/);
  assert.match(mobile, /\.transaction-list\s*\{[^}]*overscroll-behavior-y:\s*auto/);
});
