"use client";

import { BarChart3, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { useMarketDashboard } from "@/hooks/use-market-dashboard";
import type { AddressType } from "@/utils/address";

type MarketHeaderProps = {
  streamStatus: ReturnType<typeof useMarketDashboard>["streamStatus"];
  addressType: AddressType;
  onAddressTypeChange: (type: AddressType) => void;
};

/** 页面顶栏始终显示，地址偏好由页面统一管理并传给交易列表。 */
export function MarketHeader({ streamStatus, addressType, onAddressTypeChange }: MarketHeaderProps) {
  return (
    <header className="topbar page-width">
      <div className="brand-lockup">
        <div className="brand-mark"><BarChart3 size={17} /></div>
        <div>
          <p className="brand-name">chart</p>
          <p className="brand-subtitle">MARKET TERMINAL</p>
        </div>
      </div>
      <div className="topbar-actions">
        <Badge variant="outline" className={`live-badge stream-${streamStatus}`}><span className="live-dot" />{streamStatus === "connected" ? "SSE 已连接" : streamStatus === "fallback" ? "轮询备用" : "SSE 连接中"}</Badge>
        <Badge variant="outline" className="network-chip"><Radio size={13} /> Interstellar</Badge>
        <ToggleGroup type="single" size="sm" value={addressType} onValueChange={(value) => { if (value === "0x" || value === "hg") onAddressTypeChange(value); }} className="address-type-toggle" aria-label="交易者地址格式">
          {(["0x", "hg"] as const).map((type) => (
            <ToggleGroupItem value={type} key={type} aria-label={`${type} 地址`} className={addressType === type ? "active" : ""}>{type}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </header>
  );
}
