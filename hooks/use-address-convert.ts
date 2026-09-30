"use client";

import { useCallback, useEffect, useState } from "react";
import { type AddressType } from "@/utils/address";

const STORAGE_KEY = "chart-transaction-address-type";

/** 默认显示 hg；仅在挂载后读取偏好，避免服务端与首次客户端渲染不一致。 */
export function useAddressConvert() {
  const [addressType, setAddressType] = useState<AddressType>("hg");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved === "0x" || saved === "hg") setAddressType(saved);
      } catch {
        // 无痕模式或 WebView 禁止本地存储时，切换仍可在当前页面生效。
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const changeAddressType = useCallback((next: AddressType) => {
    setAddressType(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 存储失败不阻塞展示和复制。
    }
  }, []);

  return { addressType, changeAddressType };
}
