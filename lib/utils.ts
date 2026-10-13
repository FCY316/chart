import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn/ui 统一类名合并：调用方的尺寸/布局可覆盖默认 Tailwind 样式。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
