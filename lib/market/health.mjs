import { withMarketDatabase } from "./database.mjs";
import { assertMarketIdentity, readStateRow } from "./repository.mjs";

/** Worker 写探测结果，Web 只读；不把 RPC URL、原始错误或文件路径暴露到公网。 */
export async function writeWorkerStatus(config, patch) {
  return withMarketDatabase(config, true, (db) => {
    const state = readStateRow(db);
    if (state) assertMarketIdentity(JSON.parse(state.header), config);
    const old = db.prepare("SELECT payload FROM worker_status WHERE id = 1").get();
    const status = { ...(old ? JSON.parse(old.payload) : {}), ...patch };
    db.prepare("INSERT INTO worker_status VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload").run(JSON.stringify(status));
  });
}

/** 无成交并不等于过期：看链高度、扫块断点、探测时间和链自身出块时间。 */
export function evaluateMarketHealth({ header, indexedBlock, worker, now = Date.now(), staleAfterMs = 90_000 }) {
  const checkedAt = worker?.checkedAt ?? null;
  const checkedMs = checkedAt ? Date.parse(checkedAt) : NaN;
  const ageMs = Number.isFinite(checkedMs) ? Math.max(0, now - checkedMs) : null;
  const chainAgeMs = Number.isFinite(worker?.chainTime) ? Math.max(0, now - worker.chainTime * 1_000) : null;
  const observedBlock = Number.isSafeInteger(worker?.observedBlock) ? worker.observedBlock : null;
  const lagBlocks = observedBlock !== null && indexedBlock !== null ? Math.max(0, observedBlock - indexedBlock) : null;
  let status = "healthy", reason = "行情同步正常";
  if (!header) { status = "unready"; reason = "行情尚未就绪，正在等待首次同步"; }
  else if (ageMs === null) { status = "unknown"; reason = "暂无 Worker 探测信息，请启动新版监听进程"; }
  else if (ageMs > staleAfterMs || worker?.error) { status = "stale"; reason = "链上行情更新中断，请勿将旧行情视为实时价格"; }
  else if (chainAgeMs === null || chainAgeMs > staleAfterMs) { status = "stale"; reason = "节点返回的区块时间过旧，请检查 RPC 或链状态"; }
  else if (observedBlock < indexedBlock) { status = "stale"; reason = "RPC 高度低于已保存断点，已暂停写入"; }
  else if (lagBlocks > 0) { status = "catching_up"; reason = `正在追块，落后 ${lagBlocks} 个区块`; }
  return { status, reason, observedBlock, indexedBlock, lagBlocks, checkedAt, indexedAt: header?.history?.indexedAt ?? null,
    chainTime: worker?.chainTime ?? null, ageMs, staleAfterMs, serverTime: new Date(now).toISOString(),
    timestampAccuracy: header?.history?.timestampVersion === 1 ? "exact" : "estimated" };
}

export async function readMarketHealth(config) {
  return withMarketDatabase(config, false, (db) => {
    const row = readStateRow(db);
    const header = row ? JSON.parse(row.header) : null;
    if (header) assertMarketIdentity(header, config);
    const hasStatus = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'worker_status'").get();
    const saved = hasStatus ? db.prepare("SELECT payload FROM worker_status WHERE id = 1").get() : null;
    return evaluateMarketHealth({ header, indexedBlock: row?.last_block ?? null, worker: saved ? JSON.parse(saved.payload) : null,
      staleAfterMs: Math.max(90_000, config.pollIntervalMs * 3) });
  }) ?? evaluateMarketHealth({ header: null, indexedBlock: null, worker: null });
}
