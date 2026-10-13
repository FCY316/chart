export const TERMINAL_HEIGHT_KEY = "chart-terminal-height-v2";
export const DEFAULT_CHART_HEIGHT = 720;
export const MIN_CHART_HEIGHT = 480;
export const MAX_CHART_HEIGHT = 2000;

/** 独立像素高度，不读取旧版会压缩交易区的百分比偏好。 */
export function clampChartHeight(height: number) {
  return Number.isFinite(height) ? Math.round(Math.min(MAX_CHART_HEIGHT, Math.max(MIN_CHART_HEIGHT, height))) : DEFAULT_CHART_HEIGHT;
}
export function parseChartHeight(value: string | null): number | undefined {
  try {
    const data = JSON.parse(value ?? "null");
    if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.chartHeight !== "number" || !Number.isFinite(data.chartHeight)) return;
    return clampChartHeight(data.chartHeight);
  } catch { return; }
}
export function readChartHeight(): number {
  try { return parseChartHeight(window.localStorage.getItem(TERMINAL_HEIGHT_KEY)) ?? DEFAULT_CHART_HEIGHT; }
  catch { return DEFAULT_CHART_HEIGHT; }
}
/** 只在结束拖拽/键盘调整时保存，存储受限不影响当前会话。 */
export function saveChartHeight(height: number) {
  if (!Number.isFinite(height)) return;
  try { window.localStorage.setItem(TERMINAL_HEIGHT_KEY, JSON.stringify({ chartHeight: clampChartHeight(height) })); } catch { /* 存储不可用。 */ }
}
