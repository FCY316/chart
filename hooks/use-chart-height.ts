"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { clampChartHeight, DEFAULT_CHART_HEIGHT, MAX_CHART_HEIGHT, MIN_CHART_HEIGHT, readChartHeight, saveChartHeight } from "@/utils/terminal-layout";

/** 只改变图表像素高度，交易区不参与计算；窗口缩放不会覆盖偏好。 */
export function useChartHeight() {
  const [height, setHeight] = useState(DEFAULT_CHART_HEIGHT);
  const [dragging, setDragging] = useState(false);
  const heightRef = useRef(DEFAULT_CHART_HEIGHT);
  const dragRef = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const apply = useCallback((value: number) => {
    heightRef.current = clampChartHeight(value);
    setHeight(heightRef.current);
  }, []);
  useEffect(() => {
    // 延后一帧恢复，保证 SSR/水合尺寸一致，并取消卸载后的迟到恢复。
    const frame = window.requestAnimationFrame(() => { if (!dragRef.current) apply(readChartHeight()); });
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag && drag.pointerId === event.pointerId) apply(drag.height + event.clientY - drag.y);
    };
    const finish = (event: Event) => {
      const drag = dragRef.current;
      if (!drag || ("pointerId" in event && event.pointerId !== drag.pointerId)) return;
      dragRef.current = null;
      setDragging(false);
      saveChartHeight(heightRef.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      dragRef.current = null;
    };
  }, [apply]);
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    dragRef.current = { pointerId: event.pointerId, y: event.clientY, height: heightRef.current };
    // 拖动期间临时保护 iframe，避免向上拖被 TradingView 吞掉。
    setDragging(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 100 : 20;
    const next = event.key === "ArrowUp" ? heightRef.current - step : event.key === "ArrowDown" ? heightRef.current + step
      : event.key === "Home" ? MIN_CHART_HEIGHT : event.key === "End" ? MAX_CHART_HEIGHT : undefined;
    if (next === undefined) return;
    event.preventDefault();
    apply(next);
    saveChartHeight(heightRef.current);
  };
  const reset = () => { apply(DEFAULT_CHART_HEIGHT); saveChartHeight(DEFAULT_CHART_HEIGHT); };
  return { height, dragging, onPointerDown, onKeyDown, reset };
}
