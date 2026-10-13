import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "chart",
  description: "chart — InterstellarChain HUGE / NFX 行情",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#060a0f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="dark">
      <body><TooltipProvider delayDuration={250}>{children}</TooltipProvider></body>
    </html>
  );
}
