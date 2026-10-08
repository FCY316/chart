import fs from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveDataFile } from "./storage.mjs";

/** 监听、重建、补齐共享单写者锁；不能一边监听一边离线修改同一份 JSON。 */
export async function acquireMarketWriterLock(config, purpose) {
  const file = `${resolveDataFile(config)}.lock`;
  const token = randomUUID();
  await fs.mkdir(path.dirname(file), { recursive: true });
  let handle;
  try {
    handle = await fs.open(file, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`行情文件已被写入进程占用：${file}。请先停止 watcher／其他写入命令。若进程异常退出，请确认没有写入进程后再移走残留锁文件。`);
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ token, pid: process.pid, purpose, startedAt: new Date().toISOString() }));
  } catch (error) {
    await fs.unlink(file);
    throw error;
  } finally {
    await handle.close();
  }

  // 首次全量同步尚未装好信号处理器时退出，也要清理自己的锁；SIGKILL 不能捕获。
  const onExit = () => {
    try {
      if (JSON.parse(readFileSync(file, "utf8")).token === token) unlinkSync(file);
    } catch { /* 不删除其他进程的锁。 */ }
  };
  process.once("exit", onExit);
  return async () => {
    process.removeListener("exit", onExit);
    try {
      if (JSON.parse(await fs.readFile(file, "utf8")).token === token) await fs.unlink(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  };
}

export async function withMarketWriterLock(config, purpose, operation) {
  const release = await acquireMarketWriterLock(config, purpose);
  try {
    return await operation();
  } finally {
    await release();
  }
}
