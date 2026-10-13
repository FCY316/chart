/** 快捷入口统一注册表：名称使用原生 API，别名兼容原生图例的简称。 */
function study(name: string, title: string, overlay: boolean, aliases: string[] = [], lengths = [0]) {
  return { name, title, overlay, aliases: [name, ...aliases], lengths };
}

export const INDICATORS = {
  VOL: study("Volume", "成交量 · NFX 成交额，仅统计买卖", false, ["VOL"]),
  MA: study("Moving Average", "简单移动平均线 · 默认 5 / 10 / 20", true, ["MA"], [5, 10, 20]),
  EMA: study("Moving Average Exponential", "指数移动平均线 · 默认 12 / 26", true, ["EMA", "MAExp", "Exponential Moving Average"], [12, 26]),
  BOLL: study("Bollinger Bands", "布林带", true, ["BB", "BOLL"]),
  MACD: study("MACD", "平滑异同移动平均线", false),
  RSI: study("Relative Strength Index", "相对强弱指标", false, ["RSI"]),
  KD: study("Stochastic", "随机指标 KD（K、D 两条线，不是三线 KDJ）", false, ["Stoch", "KD"]),
  StochRSI: study("Stochastic RSI", "随机相对强弱指标", false, ["Stoch RSI", "StochRSI"]),
  CCI: study("Commodity Channel Index", "顺势指标", false, ["CCI"]),
  WR: study("Williams %R", "威廉指标", false, ["%R", "WR"]),
  ATR: study("Average True Range", "平均真实波幅", false, ["ATR"]),
  OBV: study("On Balance Volume", "能量潮 · 使用当前 NFX 成交额作为 volume", false, ["OBV"]),
  SAR: study("Parabolic SAR", "抛物线转向指标", true, ["SAR"]),
};

export type IndicatorGroup = keyof typeof INDICATORS;
export const INDICATOR_GROUPS = Object.keys(INDICATORS) as IndicatorGroup[];
export const normalizeStudyName = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");

export function belongsToIndicator(name: string, group: IndicatorGroup) {
  return INDICATORS[group].aliases.some((alias) => normalizeStudyName(alias) === normalizeStudyName(name));
}
