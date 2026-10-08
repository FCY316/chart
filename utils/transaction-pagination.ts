const MOBILE_VIEWPORT = "(max-width: 759px)";

/**
 * 手机列表随页面纵向展开，因此用页面视口判定触底；PC 列表仍独立纵向滚动。
 * 横向滑动只改变表格位置，不改变分页；旋转屏幕时重新选择观察根节点。
 */
export function observeTransactionPagination(list: HTMLDivElement, sentinel: HTMLDivElement, onVisible: () => void) {
  const mobileViewport = window.matchMedia(MOBILE_VIEWPORT);
  let observer: IntersectionObserver;

  const observe = () => {
    observer?.disconnect();
    observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) onVisible();
    }, { root: mobileViewport.matches ? null : list, rootMargin: "120px 0px" });
    observer.observe(sentinel);
  };

  observe();
  mobileViewport.addEventListener("change", observe);
  return () => {
    mobileViewport.removeEventListener("change", observe);
    observer.disconnect();
  };
}
