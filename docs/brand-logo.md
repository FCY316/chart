# chart 项目 Logo

使用内置 imagegen 生成，以 C 字母和上升蜡烛图表示行情终端，薄荷绿 / 蓝色沿用页面配色。没有采用 CLI/API 回退。

- `public/brand/chart-logo.png`：1254×1254 原始 PNG，保留生成图片的透明通道。
- `app/icon.png`：从同一图片等比例缩小的 64×64 PNG，用于浏览器标签页；只进行尺寸优化，没有重绘。
- `components/market/market-header.tsx`：固定 31×31 展示，旁边已有 `chart` 文本，因此图片使用空 alt 避免重复朗读。
- HUGE / NFX 代币图片保持原样，不代表此项目品牌。

## 最终生成提示词

```text
Use case: logo-brand
Asset type: production PNG brand symbol for the header and app icon of "chart", an InterstellarChain cryptocurrency market terminal.
Primary request: design one original, polished, minimal logo combining a bold open C monogram with a rising candlestick-chart motif. The chart should feel structurally integrated into the C, not a separate pasted icon. Strong distinctive silhouette, carefully balanced negative space, thick geometric forms and restrained rounded corners, legible at 31 pixels.
Style/medium: flat, precise vector-like graphic rendered as a crisp square PNG with genuine alpha transparency.
Composition/framing: one centered symbol, filling roughly 85% of a square canvas with even safety margin. No wordmark; the website already displays the project name beside the symbol.
Color palette: mint green #29cf8f as the dominant color, with a restrained blue #6ea8ff accent, designed to sit on a dark blue-black #060a0f website. Use solid fills.
Constraints: transparent background; no background tile or surrounding frame, no gradients, shadows, glows, 3D, texture, text, numbers, watermark, mockup or multiple alternatives. Do not imitate token logos or other brands.
```
