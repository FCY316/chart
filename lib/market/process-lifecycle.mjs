/** 启动前即安装信号处理器：历史校正/首次追块期间也能停止并释放写锁。 */
export async function runMarketProcess(operation, { watch = false } = {}) {
  const controller = new AbortController();
  let worker, stopping, resolveStopped, rejectStopped;
  const stopped = new Promise((resolve, reject) => { resolveStopped = resolve; rejectStopped = reject; });
  // 非 watch 的启动失败也可能没有 await stopped，避免取消清理报错成为未处理拒绝。
  stopped.catch(() => {});
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    controller.abort();
    if (worker?.stop) worker.stop().then(resolveStopped, rejectStopped);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    worker = await operation(controller.signal);
    if (controller.signal.aborted) { await worker?.stop?.(); return null; }
    if (watch) await stopped;
    return worker;
  } catch (error) {
    if (controller.signal.aborted && error?.name === "AbortError") return null;
    throw error;
  } finally {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
  }
}
