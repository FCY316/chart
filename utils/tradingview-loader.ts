const SCRIPT_ID = "tradingview-charting-library";
let pending: Promise<void> | undefined;

function isLibraryReady() {
  const library = (window as Window & { TradingView?: { widget?: unknown } }).TradingView;
  return typeof library?.widget === "function";
}

/** 多个挂载共享脚本加载；失败释放状态，重试不会等待已经失败的 load 事件。 */
export function loadTradingViewLibrary(): Promise<void> {
  if (isLibraryReady()) return Promise.resolve();
  if (pending) return pending;

  const request = new Promise<void>((resolve, reject) => {
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const isNew = !script;
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = "/charting_library/charting_library.js";
      script.async = true;
    }
    const activeScript = script;
    const finish = (message?: string) => {
      window.clearTimeout(timeout);
      activeScript.removeEventListener("load", onLoad);
      activeScript.removeEventListener("error", onError);
      if (message) {
        activeScript.remove();
        reject(new Error(message));
      } else {
        resolve();
      }
    };
    const onLoad = () => finish(isLibraryReady() ? undefined : "图表脚本已下载，但无法运行");
    const onError = () => finish("图表脚本下载失败，请检查网络后重试");
    const timeout = window.setTimeout(() => finish("图表脚本下载超时，请重试"), 25_000);
    activeScript.addEventListener("load", onLoad, { once: true });
    activeScript.addEventListener("error", onError, { once: true });
    if (isNew) document.head.appendChild(activeScript);
  });

  pending = request.catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
