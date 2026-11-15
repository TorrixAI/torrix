import { cssVar } from "./theme";

// Shared ECharts option builders so every chart in the console uses the same
// tokens, tooltip treatment, axis style and accessibility metadata.

export function seriesColors(): string[] {
  return [cssVar("--s1"), cssVar("--s2"), cssVar("--s3"), cssVar("--s4"), cssVar("--s5"), cssVar("--s6")];
}

/** Convert a hex token to rgba with an alpha, for gradients. */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return color;
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function verticalGradient(color: string, top = 0.22, bottom = 0): object {
  return { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: withAlpha(color, top) }, { offset: 1, color: withAlpha(color, bottom) }] };
}

export function horizontalGradient(color: string, left = 0.9, right = 0.25): object {
  return { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: withAlpha(color, left) }, { offset: 1, color: withAlpha(color, right) }] };
}

export function axisBase(): object {
  return {
    axisLine: { lineStyle: { color: cssVar("--line") } },
    axisTick: { show: false },
    axisLabel: { color: cssVar("--text-3"), fontSize: 11, fontFamily: "Geist", hideOverlap: true },
  };
}

export function splitLine(): object {
  return { lineStyle: { color: cssVar("--chart-grid"), type: "solid", width: 1 } };
}

export function tooltipBase(trigger: "axis" | "item" = "axis"): object {
  return {
    trigger,
    backgroundColor: cssVar("--tooltip-bg"),
    borderColor: cssVar("--tooltip-line"),
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: cssVar("--tooltip-text"), fontSize: 11, fontFamily: "Geist" },
    extraCssText: "box-shadow: 0 16px 44px -18px rgba(21,22,26,.26); border-radius: 6px;",
  };
}

export function gridBase(extra: Record<string, number> = {}): object {
  return { left: 8, right: 14, top: 34, bottom: 4, containLabel: true, ...extra };
}

/** Common shell: accessibility metadata and a restrained animation. */
export function baseOption(): object {
  return {
    aria: { enabled: true, decal: { show: false } },
    animationDuration: 320,
    animationEasing: "cubicOut",
  };
}

export function legendBase(): object {
  return {
    top: 0,
    right: 4,
    icon: "roundRect",
    itemWidth: 8,
    itemHeight: 8,
    itemGap: 14,
    textStyle: { color: cssVar("--text-3"), fontSize: 11, fontFamily: "Geist" },
  };
}

/** A bar series with a soft vertical gradient and rounded top corners. */
export function barSeries(name: string, color: string, data: number[], options: Record<string, unknown> = {}): object {
  return {
    name,
    type: "bar",
    barMaxWidth: 18,
    itemStyle: { borderRadius: [2, 2, 0, 0], color },
    emphasis: { itemStyle: { color: withAlpha(color, 0.85) } },
    data,
    ...options,
  };
}

/** A line series, optionally with an area gradient fill. */
export function lineSeries(name: string, color: string, data: Array<number | null>, options: Record<string, unknown> = {}): object {
  const { area, lineStyle, ...rest } = options as { area?: boolean; lineStyle?: object };
  return {
    name,
    type: "line",
    smooth: 0.32,
    symbol: "none",
    lineStyle: { width: 2, color, ...(lineStyle ?? {}) },
    itemStyle: { color },
    ...(area ? { areaStyle: { color: verticalGradient(color) } } : {}),
    data,
    ...rest,
  };
}

/** Donut with a hollow center (the page adds the total readout). */
export function donutSeries(data: Array<{ name: string; value: number }>): object {
  return {
    type: "pie",
    radius: ["62%", "86%"],
    center: ["50%", "52%"],
    label: { show: false },
    labelLine: { show: false },
    itemStyle: { borderColor: cssVar("--surface"), borderWidth: 3 },
    emphasis: { scale: true, scaleSize: 4 },
    data,
  };
}
