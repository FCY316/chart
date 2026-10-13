import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

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
    let appliedOverrides;
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
      addEventListener() {}, removeEventListener() {},
      localStorage: { getItem: () => JSON.stringify({ version: 1, layout: { charts: [{ oldBackground: "#000000" }] } }), setItem() {} },
      TradingView: { widget: class {
        constructor(config) { options = config; }
        onChartReady(callback) { callback(); }
        applyOverrides(overrides) { appliedOverrides = overrides; }
        activeChart() { return { getAllStudies: () => [], createStudy: async () => "study" }; }
        getStudiesList() { return ["Volume", "Moving Average"]; }
        subscribe() {}
        unsubscribe() {}
        save(callback) { callback({ charts: [{}] }); }
        remove() {}
      } },
    };
    const { TradingViewChart } = loadTypeScript("components/tradingview-chart.tsx", {
      react: fakeReact,
      "@/utils/tradingview-loader": { loadTradingViewLibrary: () => Promise.resolve() },
      "@/lib/market-client": { fetchCandlePage: () => { throw new Error("本测试不应请求行情"); } },
    });
    TradingViewChart({ candlesByInterval: {}, interval: "5m", currentPrice: 1800, updatedAt: "2026-10-08T00:00:00.000Z", chainId: 1677, pairAddress: "0xabc" });
    const cleanups = effects.slice(0, 3).map((effect) => effect());
    await Promise.resolve();
    assert.ok(options.disabled_features.includes("vert_touch_drag_scroll"));
    for (const feature of ["horz_touch_drag_scroll", "pinch_scale", "pressed_mouse_move_scroll", "mouse_wheel_scale"]) assert.ok(!options.disabled_features.includes(feature));
    assert.equal(options.enabled_features.includes("iframe_loading_compatibility_mode"), true);
    assert.equal(options.overrides["paneProperties.legendProperties.showSeriesOHLC"], true);
    assert.equal(options.overrides["paneProperties.background"], "#0b1118");
    assert.deepEqual(appliedOverrides, { "paneProperties.background": "#0b1118", "paneProperties.backgroundType": "solid", "scalesProperties.textColor": "#8290a3" });
    assert.equal(options.saved_data.charts[0].oldBackground, "#000000", "保留用户旧布局，加载后恢复原配色");
    for (const feature of ["volume_force_overlay", "create_volume_indicator_by_default"]) assert.ok(options.disabled_features.includes(feature));
    for (const cleanup of cleanups) cleanup?.();
  }
});

test("默认只启用 VOL，MA 手动开启 5/10/20；指标切换与参数持久化", async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  const storage = new Map(), listeners = new Map(), events = new Map();
  globalThis.window = { setTimeout, clearTimeout,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
  };
  const { chartLayoutKey, createChartPreferences, readChartLayout, EMPTY_INDICATORS } = loadTypeScript("utils/tradingview-preferences.ts");
  const { INDICATORS, INDICATOR_GROUPS } = loadTypeScript("utils/tradingview-indicators.ts");
  const key = chartLayoutKey(1677, "0xAbC"), other = chartLayoutKey(1677, "0xDEF");
  assert.equal(key, chartLayoutKey(1677, "0xabc"));
  assert.notEqual(key, other);
  let studies = [], serial = 0, state, picker;
  const chart = {
    getAllStudies: () => studies,
    createStudy: async (name, overlay, locked, inputs) => {
      const id = String(++serial);
      studies.push({ id, name, overlay, locked, inputs });
      return id;
    },
    removeEntity: (id) => { studies = studies.filter((study) => study.id !== id); },
    executeActionById: (action) => { picker = action; },
  };
  const widget = { activeChart: () => chart, getStudiesList: () => Object.values(INDICATORS).map((item) => item.name),
    subscribe: (name, callback) => events.set(name, callback),
    unsubscribe: (name) => events.delete(name),
    save: (callback) => callback({ charts: [{ studies, paneSizes: [400, 120] }] }),
  };
  const controller = createChartPreferences(widget, key, (value) => { state = value; });
  await controller.initialize(false);
  assert.deepEqual(studies.map((study) => [study.name, study.overlay, study.inputs.length]), [
    ["Volume", false, undefined],
  ]);
  assert.deepEqual(state, { ...EMPTY_INDICATORS, VOL: true, MA: false, busy: false });
  await controller.toggle("MA");
  assert.deepEqual(studies.filter(study=>study.name==="Moving Average").map(study=>study.inputs.length),[5,10,20]);
  await Promise.all([controller.toggle("EMA"), controller.toggle("EMA")]);
  assert.deepEqual(studies.filter((study) => study.name.includes("Exponential")).map((study) => study.inputs.length), [12, 26]);
  await controller.toggle("EMA");
  assert.equal(state.EMA, false);
  // 每个快捷入口的原生名称、主图/副图位置、重复开关及删除都要正确。
  for (const group of INDICATOR_GROUPS.filter((group) => !["VOL", "MA"].includes(group))) {
    await controller.toggle(group);
    assert.equal(state[group], true);
    const created = studies.filter((study) => study.name === INDICATORS[group].name);
    assert.equal(created.length, INDICATORS[group].lengths.length);
    assert.ok(created.every((study) => study.overlay === INDICATORS[group].overlay));
    // 原生 UI 使用简称，仍能正确同步快捷按钮并关闭，不能误删相似的其他指标。
    for (const study of created) study.name = INDICATORS[group].aliases.at(-1);
    studies.push({ id: "unrelated", name: "Bollinger Bands Width" });
    events.get("study_event")();
    assert.equal(state[group], true);
    await controller.toggle(group);
    assert.equal(state[group], false);
    assert.ok(studies.some((study) => study.id === "unrelated"));
    studies = studies.filter((study) => study.id !== "unrelated");
  }
  studies[1].inputs.length = 7;
  listeners.get("pagehide")();
  assert.equal(readChartLayout(key).charts[0].studies[1].inputs.length, 7);
  assert.deepEqual(readChartLayout(key).charts[0].paneSizes, [400, 120]);
  assert.equal(readChartLayout(other), undefined);
  controller.more(); assert.equal(picker, "insertIndicator");
  controller.dispose();
  assert.equal(events.size, 0); assert.equal(listeners.size, 0);

  // 保存布局即使移除了所有指标也应尊重，不能刷新后强行补回默认项。
  studies = [];
  const restored = createChartPreferences(widget, key, () => {});
  await restored.initialize(true);
  assert.equal(studies.length, 0);
  restored.dispose();
  storage.set(key, "{bad-json"); assert.equal(readChartLayout(key), undefined);
  storage.set(key, JSON.stringify({ version: 1, layout: { charts: [{}, {}] } })); assert.equal(readChartLayout(key), undefined);
});

test("指标初始化中销毁不会继续创建；浏览器禁止存储不阻断指标使用", async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  globalThis.window = { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {},
    get localStorage() { throw new Error("storage disabled"); } };
  const { createChartPreferences, readChartLayout } = loadTypeScript("utils/tradingview-preferences.ts");
  assert.equal(readChartLayout("key"), undefined);
  let resolveStudy, calls = 0;
  const widget = { activeChart: () => ({ getAllStudies: () => [], createStudy: () => { calls++; return new Promise((resolve) => { resolveStudy = resolve; }); } }),
    getStudiesList: () => ["Volume", "Moving Average"],
    save: (callback) => callback({ charts: [{}] }), subscribe() {}, unsubscribe() {} };
  const controller = createChartPreferences(widget, "key", () => {});
  const initialized = controller.initialize(false);
  controller.dispose(); resolveStudy("id"); await initialized;
  assert.equal(calls, 1);
  const restored = createChartPreferences(widget, "key", () => {});
  await restored.initialize(true); restored.dispose();
});

test("iframe 已销毁时偏好 dispose 仍释放定时器/本地监听，逐项取消订阅并可重复调用", async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  const listeners = new Map(), timers = new Map(), events = new Map(), unsubscribed = [];
  let savedCallback, writes = 0, publishes = 0;
  globalThis.window = {
    setTimeout: (callback) => { timers.set(1, callback); return 1; }, clearTimeout: (id) => timers.delete(id),
    addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: (name) => listeners.delete(name),
    localStorage: { setItem: () => { writes++; } },
  };
  const { createChartPreferences } = loadTypeScript("utils/tradingview-preferences.ts");
  const widget = {
    activeChart: () => ({ getAllStudies: () => [] }), getStudiesList: () => [],
    subscribe: (name, callback) => events.set(name, callback),
    unsubscribe: (name) => {
      assert.equal(listeners.size, 0, "先清除本地 pagehide，不依赖已失效的 iframe API");
      unsubscribed.push(name);
      throw new TypeError("Cannot read properties of null (reading 'doWhenApiIsReady')");
    },
    save: (callback) => { savedCallback = callback; },
  };
  const controller = createChartPreferences(widget, "key", () => { publishes++; });
  await controller.initialize(true);
  await controller.initialize(true);
  assert.equal(events.size, 8);
  const changed = events.get("study_event");
  changed();
  assert.equal(timers.size, 1);
  const beforeDispose = publishes;
  assert.doesNotThrow(() => controller.dispose());
  assert.equal(unsubscribed.length, 8, "一项失败后继续处理剩余订阅");
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
  assert.doesNotThrow(() => controller.dispose());
  assert.equal(unsubscribed.length, 8, "重复清理不再触碰失效 API");
  changed(); savedCallback({ charts: [{}] });
  assert.equal(publishes, beforeDispose);
  assert.equal(writes, 0, "销毁后迟到的保存回调不写本地设置");
});

test("偏好初始化订阅中途失败，也能清理已经成功建立的部分订阅", async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  const removed = [];
  let registered = 0;
  globalThis.window = { clearTimeout() {}, removeEventListener() {} };
  const { createChartPreferences } = loadTypeScript("utils/tradingview-preferences.ts");
  const controller = createChartPreferences({
    activeChart: () => ({ getAllStudies: () => [] }), getStudiesList: () => [],
    subscribe: () => { if (++registered === 3) throw new Error("iframe 已失效"); },
    unsubscribe: (name) => removed.push(name),
  }, "key", () => {});
  await assert.rejects(controller.initialize(true), /iframe 已失效/);
  assert.doesNotThrow(() => controller.dispose());
  assert.deepEqual(removed, ["onAutoSaveNeeded", "study"]);
});

test("实际图表 effect 清理失败仍销毁 widget、清空引用，重试不复用旧实例", async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  const effects = [], refs = [];
  let disposed = 0, removed = 0, created = 0;
  const fakeReact = {
    useCallback: (callback) => callback, useState: (value) => [value, () => {}],
    useRef: (value) => { const ref = { current: refs.length === 0 ? {} : value }; refs.push(ref); return ref; },
    useEffect: (effect) => effects.push(effect),
  };
  globalThis.window = {
    setTimeout: () => 1, clearTimeout() {},
    TradingView: { widget: class {
      constructor() { created++; }
      onChartReady(callback) { callback(); }
      applyOverrides() {}
      remove() { removed++; throw new Error("iframe 已移除"); }
    } },
  };
  const preferences = loadTypeScript("utils/tradingview-preferences.ts");
  const { TradingViewChart } = loadTypeScript("components/tradingview-chart.tsx", {
    react: fakeReact,
    "@/utils/tradingview-loader": { loadTradingViewLibrary: () => Promise.resolve() },
    "@/utils/tradingview-preferences": { ...preferences, readChartLayout: () => undefined,
      createChartPreferences: () => ({ initialize: async () => {}, dispose: () => { disposed++; throw new Error("API 已销毁"); } }) },
  });
  TradingViewChart({ candlesByInterval: {}, interval: "5m", currentPrice: 1800, updatedAt: "2026-10-13T00:00:00Z", chainId: 1677, pairAddress: "0xabc" });
  for (const attempt of [1, 2]) {
    const cleanup = effects[2]();
    await Promise.resolve();
    assert.equal(created, attempt);
    assert.ok(refs[1].current);
    assert.doesNotThrow(cleanup);
    assert.equal(refs[1].current, null);
    assert.equal(disposed, attempt);
    assert.equal(removed, attempt, "偏好清理失败不阻断 widget.remove");
    assert.doesNotThrow(cleanup);
    assert.equal(removed, attempt, "旧 effect 不重复销毁实例");
  }
});

test("当前库缺少某指标时明确报错，不影响其他指标或阻塞后续操作", async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  globalThis.window = { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  const { createChartPreferences } = loadTypeScript("utils/tradingview-preferences.ts");
  let state;
  const widget = { getStudiesList: () => [], activeChart: () => ({ getAllStudies: () => [], createStudy: () => assert.fail("不应创建不可用的指标") }),
    save: (callback) => callback({ charts: [{}] }), subscribe() {}, unsubscribe() {} };
  const controller = createChartPreferences(widget, "key", (value) => { state = value; });
  await controller.initialize(true);
  await controller.toggle("MACD");
  assert.match(state.error, /MACD.*不可用/);
  assert.equal(state.busy, false); assert.equal(state.MACD, false);
  controller.dispose();
});

test("常用指标全部直接展示，横向滑动区域与更多入口分离", () => {
  const { ChartIndicators } = loadTypeScript("components/market/chart-indicators.tsx");
  const { TooltipProvider } = loadTypeScript("components/ui/tooltip.tsx");
  const { EMPTY_INDICATORS } = loadTypeScript("utils/tradingview-preferences.ts");
  const html = renderToStaticMarkup(createElement(TooltipProvider, null, ChartIndicators({ state: { ...EMPTY_INDICATORS, busy: false }, onToggle() {}, onMore() {} })));
  for (const name of ["VOL", "MA", "EMA", "BOLL", "MACD", "RSI", "KD", "StochRSI", "CCI", "WR", "ATR", "OBV", "SAR"]) assert.ok(html.includes(`>${name}</button>`));
  assert.match(html, /常用指标，可横向滑动/);
  assert.match(html, /不是三线 KDJ/);
  assert.match(fs.readFileSync("app/globals.css", "utf8"), /\.indicator-options\s*\{[^}]*overflow-x:\s*auto/);
});

test("交易行八列：时间不是链接，只有 Hash 跳转完整交易地址，块高与缺失状态正确", () => {
  const { TransactionRow } = loadTypeScript("components/market/transaction-row.tsx");
  const transaction = { side: "Buy", time: "2026-10-13T03:00:00Z", wallet: `0x${"a".repeat(40)}`,
    tx: `0x${"b".repeat(64)}`, blockNumber: 749201, logIndex: 1, price: 1800, baseAmount: 2, quoteAmount: 3600 };
  const props = { transaction, explorerUrl: "https://scan.interstellarchain.org/", copiedTarget: null, addressType: "0x", onCopy: async () => {} };
  const html = renderToStaticMarkup(TransactionRow(props));
  assert.equal((html.match(/<td\b/g) ?? []).length, 8);
  assert.equal((html.match(/<a\b/g) ?? []).length, 1);
  assert.match(html, /<span class="transaction-time"/);
  assert.ok(html.includes(`href="https://scan.interstellarchain.org/tx/${transaction.tx}"`));
  assert.ok(html.includes(`title="${transaction.tx}"`));
  assert.match(html, /class="transaction-hash"/);
  assert.match(html, /class="[^"]*transaction-block[^"]*">749201<\/td>/);
  for (const blockNumber of [undefined, null, NaN, -1, "749201"]) {
    const missing = renderToStaticMarkup(TransactionRow({ ...props, transaction: { ...transaction, blockNumber } }));
    assert.match(missing, /class="[^"]*transaction-block[^"]*">—<\/td>/);
  }
  const { TransactionsPanel } = loadTypeScript("components/market/transactions-panel.tsx");
  const model = { transactionFilter: "all", visibleTransactions: [], visibleCount: 20, transactions: [], transactionHasMore: true, listRef: { current: null }, loadMoreRef: { current: null } };
  const panel = renderToStaticMarkup(TransactionsPanel({ model, addressType: "0x" }));
  assert.equal((panel.match(/<th\b/g) ?? []).length, 8);
  assert.equal((panel.match(/colSpan="8"/g) ?? []).length, 2);
  assert.match(panel, /交易 Hash/); assert.match(panel, /块高/);
});

test("桌面框架固定，图表和交易在左侧内部共同滚动且高度独立", () => {
  const css = fs.readFileSync("app/globals.css", "utf8");
  const desktop = css.slice(css.indexOf("@media (min-width: 1024px)"));
  assert.match(desktop, /\.market-app\s*\{[^}]*height:\s*100dvh;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden/);
  assert.match(desktop, /\.terminal-panels\s*\{[^}]*height:\s*100%;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto/);
  assert.match(desktop, /\.market-sidebar\s*\{[^}]*height:\s*100%;[^}]*overflow-y:\s*auto/);
  assert.match(desktop, /height:\s*var\(--terminal-chart-height, 720px\)/);
  assert.match(desktop, /\.transactions-card\s*\{[^}]*min-height:\s*640px/);
  assert.match(desktop, /\.transaction-table td\s*\{[^}]*height:\s*46px;[^}]*padding:\s*9px 16px/);
  assert.match(desktop, /\.transactions-card\s*\{[^}]*height:\s*640px/);
  assert.match(desktop, /\.transaction-list\s*\{[^}]*overflow:\s*auto/);
  assert.match(css, /\.terminal-panels, \.chart-resizable\s*\{\s*display:\s*contents/);
});

test("独立图表高度校验和保存，不读取旧的上下分摊比例", (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  const { readChartHeight, saveChartHeight, parseChartHeight, clampChartHeight, TERMINAL_HEIGHT_KEY } = loadTypeScript("utils/terminal-layout.ts");
  const values = new Map();
  globalThis.window = { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value) } };
  assert.equal(readChartHeight(),720);
  saveChartHeight(1100); assert.equal(readChartHeight(),1100);
  assert.equal(clampChartHeight(100),480); assert.equal(clampChartHeight(4000),2000);
  for (const value of [null,"null","[]","{","{}",'{"chart":58,"trades":42}','{"chartHeight":"720"}']) assert.equal(parseChartHeight(value),undefined);
  saveChartHeight(NaN); assert.equal(values.get(TERMINAL_HEIGHT_KEY),'{"chartHeight":1100}');
  globalThis.window = { get localStorage() { throw new Error("blocked"); } };
  assert.equal(readChartHeight(),720);
  assert.doesNotThrow(() => saveChartHeight(720));
});

test("数据源/区块状态栏固定贴底，页面为状态栏和安全区预留空间", () => {
  const css=fs.readFileSync("app/globals.css","utf8");
  assert.match(css,/\.page-footer\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*0/);
  assert.match(css,/\.market-app\s*\{[^}]*padding-bottom:\s*calc\(28px \+ env\(safe-area-inset-bottom\)\)/);
});

test("旧指标布局一次更新 MA/VOL 默认值，之后尊重用户手动选择", async (t) => {
  const previous=globalThis.window;
  t.after(()=>{globalThis.window=previous;});
  const storage=new Map(), sizes=[];
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)}};
  const { createChartPreferences }=loadTypeScript("utils/tradingview-preferences.ts");
  let studies=[{id:"vol",name:"Volume"},{id:"old-ma",name:"Moving Average"},{id:"rsi",name:"Relative Strength Index"}];
  const pane=(id,main=false)=>({hasMainSeries:()=>main,getLeftPriceScales:()=>[],getRightPriceScales:()=>[{getStudies:()=>[id]}],setHeight:height=>sizes.push([id,height])});
  const chart={getAllStudies:()=>studies,removeEntity:id=>{studies=studies.filter(s=>s.id!==id);},createStudy:async name=>{const id=name;studies.push({id,name});return id;},executeActionById(){},getPanes:()=>[pane("main",true),pane("vol"),pane("rsi")]};
  const widget={activeChart:()=>chart,getStudiesList:()=>["Volume","Moving Average"],subscribe(){},unsubscribe(){},save:cb=>cb({charts:[{}]})};
  const controller=createChartPreferences(widget,"layout",()=>{});
  await controller.initialize(true);
  assert.ok(!studies.some(s=>s.id==="old-ma"));
  assert.ok(studies.some(s=>s.id==="rsi"));
  assert.deepEqual(sizes,[["vol",90]],"不能缩小其他副图或主图");
  await controller.toggle("MA");
  assert.ok(studies.some(s=>s.name==="Moving Average"));
  controller.dispose();
  const restored=createChartPreferences(widget,"layout",()=>{});
  await restored.initialize(true);
  assert.ok(studies.some(s=>s.name==="Moving Average"),"用户后来手动开启的 MA 保持不变");
  assert.equal(sizes.length,1,"不每次恢复都覆盖用户调整的副图高度");
  restored.dispose();
});

test("单图表拖动、键盘和重置持久化，取消/卸载释放监听", (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  const listeners = new Map(), effects = [], updates = [], writes = [];
  let frame, canceled = false, stateIndex = 0;
  globalThis.window = {
    requestAnimationFrame: callback => { frame=callback; return 1; }, cancelAnimationFrame: () => { canceled=true; },
    addEventListener: (name,callback) => listeners.set(name,callback),
    removeEventListener: (name,callback) => { assert.equal(listeners.get(name),callback); listeners.delete(name); },
    localStorage: { getItem: () => '{"chartHeight":900}', setItem: (_key,value) => writes.push(JSON.parse(value)) },
  };
  const { useChartHeight } = loadTypeScript("hooks/use-chart-height.ts", { react: {
    useState: value => { const index=stateIndex++; return [value, next => updates.push([index,next])]; },
    useRef: value => ({current:value}), useCallback: fn => fn, useEffect: effect => effects.push(effect),
  } });
  const hook=useChartHeight(), dispose=effects[0](); frame();
  assert.deepEqual(updates.at(-1),[0,900]);
  hook.onPointerDown({button:0,pointerId:1,clientY:100,preventDefault() {}});
  listeners.get("pointermove")({pointerId:2,clientY:350});
  assert.equal(writes.length,0);
  listeners.get("pointermove")({pointerId:1,clientY:350});
  assert.deepEqual(updates.at(-1),[0,1150]);
  listeners.get("pointerup")({pointerId:1});
  assert.deepEqual(writes.at(-1),{chartHeight:1150});
  hook.onKeyDown({key:"ArrowUp",shiftKey:false,preventDefault() {}});
  assert.deepEqual(writes.at(-1),{chartHeight:1130});
  hook.reset(); assert.deepEqual(writes.at(-1),{chartHeight:720});
  hook.onPointerDown({button:0,pointerId:3,clientY:100,preventDefault() {}});
  listeners.get("blur")({});
  assert.deepEqual(updates.at(-1),[1,false]);
  dispose(); assert.equal(listeners.size,0); assert.equal(canceled,true);
});

test("跨断点保持同一套图表/交易 DOM，分隔条只控制图表", () => {
  const { MarketWorkspace } = loadTypeScript("components/market/market-workspace.tsx");
  const html=renderToStaticMarkup(createElement(MarketWorkspace, {
    chart:createElement("div",null,"测试图表"), pair:createElement("div",null,"测试池子"),
    transactions:createElement("div",null,"测试交易"),footer:createElement("footer",null,"测试页脚"),
  }));
  for(const text of ["测试图表","测试池子","测试交易","测试页脚"]) assert.equal(html.split(text).length-1,1);
  assert.match(html,/aria-controls="market-chart-panel"/);
  assert.match(html,/aria-valuenow="720"/);
  assert.match(html,/aria-label="调整 K 线高度"/);
});

test("恢复原深蓝黑主题与渐变，保留涨跌语义与文字对比度", () => {
  const css = fs.readFileSync("app/globals.css", "utf8");
  const variable = (name) => css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  const palette = { "--background": "#060a0f", "--surface": "#0b1118", "--surface-raised": "#101923", "--line": "#1b2937", "--foreground": "#edf4fb", "--muted-foreground": "#8290a3", "--muted-strong": "#aab7c7" };
  for (const [name, color] of Object.entries(palette)) assert.equal(variable(name), color);
  assert.ok(css.includes("radial-gradient("));
  assert.ok(css.includes("linear-gradient("));
  assert.match(css, /\.chart-shell\s*\{[^}]*background:\s*var\(--surface\)/);
  assert.match(css, /\.transaction-table th\s*\{[^}]*background:\s*#151d26/);
  assert.match(css, /\.transaction-row:nth-child\(even\)\s*\{[^}]*background:\s*#101820/);
  assert.match(css, /\.transaction-row:hover\s*\{[^}]*background:\s*#18222d/);
  assert.match(css, /\.transaction-row-buy\s*\{[^}]*--transaction-tone:\s*var\(--green\)/);
  assert.match(css, /\.transaction-row-sell\s*\{[^}]*--transaction-tone:\s*var\(--red\)/);
  assert.equal(variable("--green"), "#29cf8f");
  assert.equal(variable("--red"), "#f26d78");
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  for (const foreground of ["--foreground", "--muted-foreground", "--muted-strong"]) {
    for (const background of [variable("--background"), variable("--surface"), variable("--surface-raised"), "#18222d"]) {
      assert.ok((luminance(variable(foreground)) + .05) / (luminance(background) + .05) >= 4.5, `${foreground} / ${background}`);
    }
  }
  assert.match(fs.readFileSync("app/layout.tsx", "utf8"), /themeColor:\s*"#060a0f"/);
});

test("图表外不再渲染手机开高低收栏，保留原生图表与指标入口", () => {
  const { TradingViewChart } = loadTypeScript("components/tradingview-chart.tsx");
  const { TooltipProvider } = loadTypeScript("components/ui/tooltip.tsx");
  const html = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(TradingViewChart, {
    candlesByInterval: {}, interval: "5m", currentPrice: 1800, updatedAt: "2026-10-08T00:06:00.000Z", chainId: 1677, pairAddress: "0xabc",
  })));
  assert.ok(!html.includes("最新 K 线开高低收"));
  assert.ok(!html.includes("mobile-candle-ohlc"));
  assert.match(html, /tradingview-container/);
  assert.match(html, /图表指标/);
  assert.ok(!fs.readFileSync("app/globals.css", "utf8").includes("candle-ohlc"));
});

test("滚动条统一为低对比细条，悬停不改变宽度或滚动容器", () => {
  const css = fs.readFileSync("app/globals.css", "utf8");
  const start = css.indexOf("/* 统一细滚动条");
  const rules = css.slice(start, css.indexOf("/* PC 表格", start));
  for (const name of [".terminal-panels", ".market-sidebar", ".transaction-list", ".indicator-options"]) assert.ok(rules.includes(name));
  assert.match(rules, /scrollbar-width:\s*thin/);
  assert.match(rules, /scrollbar-color:\s*var\(--scroll-thumb\) transparent/);
  assert.match(rules, /width:\s*6px; height:\s*6px/);
  assert.match(rules, /border-radius:\s*999px/);
  assert.match(rules, /:focus-within/);
  assert.ok(!rules.includes("display: none") && !rules.includes("overflow:"), "不隐藏可操作性、不改滚动根");
});

test("手机表格无独立纵向滚动范围，所有八列仍可横向查看", () => {
  const css = fs.readFileSync("app/globals.css", "utf8");
  const mobile = css.slice(css.indexOf("@media (max-width: 759px)"));
  assert.match(mobile, /\.transaction-list\s*\{[^}]*max-height:\s*none/);
  assert.match(mobile, /\.transaction-list\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(mobile, /\.transaction-list\s*\{[^}]*overflow-y:\s*hidden/);
  assert.match(mobile, /\.transaction-list\s*\{[^}]*overscroll-behavior-y:\s*auto/);
});
