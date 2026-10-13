import type { IChartingLibraryWidget, IChartWidgetApi } from "@/public/charting_library/charting_library";
import { INDICATORS, INDICATOR_GROUPS, belongsToIndicator, type IndicatorGroup } from "@/utils/tradingview-indicators";

export type { IndicatorGroup } from "@/utils/tradingview-indicators";
export type IndicatorState = Record<IndicatorGroup, boolean> & { busy: boolean; error: string };
export type IndicatorChart = Pick<IChartWidgetApi, "createStudy" | "getAllStudies" | "removeEntity" | "executeActionById">;
export type PreferenceWidget = Pick<IChartingLibraryWidget, "save" | "subscribe" | "unsubscribe" | "getStudiesList"> & { activeChart: () => IndicatorChart };
export const EMPTY_INDICATORS: IndicatorState = { ...Object.fromEntries(INDICATOR_GROUPS.map((group) => [group, false])) as Record<IndicatorGroup, boolean>, busy: true, error: "" };
const MAX_LAYOUT_BYTES = 2_000_000;

/** 按链和池子隔离，未来增加 LP 时不会串用指标和画线。行情本身不存这里。 */
export function chartLayoutKey(chainId: number, pairAddress: string) {
  return `chart:layout:v1:${chainId}:${pairAddress.toLowerCase()}`;
}

export function readChartLayout(key: string): object | undefined {
  try {
    const text = window.localStorage.getItem(key);
    if (!text || text.length > MAX_LAYOUT_BYTES) return;
    const value = JSON.parse(text);
    if (value.version === 1 && Array.isArray(value.layout?.charts) && value.layout.charts.length === 1) return value.layout;
  } catch { /* 隐私模式、配额限制、损坏缓存都不能阻断图表。 */ }
}

/** 原生指标交给 TradingView 计算；本模块只负责入口、生命周期及本地偏好。 */
export function createChartPreferences(widget: PreferenceWidget, key: string, onState: (state: IndicatorState) => void) {
  const chart = widget.activeChart();
  const supportedStudies = widget.getStudiesList();
  let disposed = false;
  let busy = true;
  let error = "";
  let timer: number | undefined;
  let saveSequence = 0;
  let initialized = false;

  const matching = (group: IndicatorGroup) => chart.getAllStudies().filter((study) => belongsToIndicator(study.name, group));
  const publish = () => {
    if (!disposed) onState({ ...Object.fromEntries(INDICATOR_GROUPS.map((group) => [group, matching(group).length > 0])) as Record<IndicatorGroup, boolean>, busy, error });
  };
  const save = () => {
    if (disposed || busy) return;
    const sequence = ++saveSequence;
    try {
      widget.save((layout) => {
        if (disposed || sequence !== saveSequence) return;
        try {
          const value = JSON.stringify({ version: 1, layout });
          if (value.length <= MAX_LAYOUT_BYTES) window.localStorage.setItem(key, value);
        } catch { /* 存储不可用时仍可使用所有指标。 */ }
      });
    } catch { /* 图表销毁或宿主禁用存储时，不影响行情。 */ }
  };
  const changed = () => {
    if (disposed) return;
    publish();
    window.clearTimeout(timer);
    timer = window.setTimeout(save, 200);
  };
  const add = async (group: IndicatorGroup) => {
    const definition = INDICATORS[group];
    // 用正在运行的库确认名称，不假定 latest 文档中的每个指标都存在于 v25。
    const name = supportedStudies.find((name) => belongsToIndicator(name, group));
    if (!name) throw new Error(`${group} 在当前 TradingView 版本中不可用，请从“更多”选择其他指标`);
    for (const [index, length] of definition.lengths.entries()) {
      if (disposed) return;
      const id = await chart.createStudy(name, definition.overlay, false,
        length ? { length } : {},
        length ? { "plot.color": ["#f6c85f", "#6ea8ff", "#bf8bfa"][index], "plot.linewidth": 1 } : {});
      if (disposed) return;
      if (id === null) throw new Error(`${group} 创建失败，请重试`);
    }
  };
  const subscriptions = ["onAutoSaveNeeded", "study", "study_event", "study_properties_changed", "panes_height_changed", "panes_order_changed", "undo", "redo"] as const;
  const registeredSubscriptions = new Set<(typeof subscriptions)[number]>();

  return {
    async initialize(restored: boolean) {
      if (disposed || initialized) return;
      initialized = true;
      try {
        // 有保存布局时尊重用户删除/参数修改，不再强行补回默认指标。
        if (!restored) { await add("VOL"); await add("MA"); }
      } catch (cause) { error = cause instanceof Error ? cause.message : "指标初始化失败"; }
      if (disposed) return;
      busy = false;
      for (const event of subscriptions) {
        widget.subscribe(event, changed);
        // 逐项记录，初始化中途失败也能清理已经建立的订阅。
        registeredSubscriptions.add(event);
      }
      window.addEventListener("pagehide", save);
      publish();
      save();
    },
    async toggle(group: IndicatorGroup) {
      if (disposed || busy) return;
      busy = true;
      error = "";
      publish();
      try {
        const studies = matching(group);
        if (studies.length) for (const study of studies) chart.removeEntity(study.id);
        else await add(group);
      } catch (cause) { error = cause instanceof Error ? cause.message : "指标切换失败，请重试"; }
      finally { busy = false; if (!disposed) { publish(); save(); } }
    },
    more() { if (!disposed && !busy) chart.executeActionById("insertIndicator"); },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.clearTimeout(timer);
      timer = undefined;
      // 本地资源先释放，不依赖 iframe 内部 API 是否仍然存在。
      window.removeEventListener("pagehide", save);
      for (const event of registeredSubscriptions) {
        try { widget.unsubscribe(event, changed); }
        catch { /* 热更新/卸载时 iframe 可能先被销毁；仍需继续清理其他订阅。 */ }
      }
      registeredSubscriptions.clear();
    },
  };
}
