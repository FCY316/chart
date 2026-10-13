import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const APPLICATION_ID = 0x43485254; // CHRT，防止把别的 SQLite 文件误当行情库。
const SCHEMA_VERSION = 1;

export function resolveDataFile(config) {
  return path.resolve(config.dataFile);
}

/** 一个 LP 对应一个库。WAL 允许同机 Web 读取与 Worker 写入并行。 */
export function openMarketDatabase(config, { write = false } = {}) {
  const file = resolveDataFile(config);
  if (!/\.(db|sqlite|sqlite3)$/i.test(file)) throw new Error("MARKET_DATA_FILE 必须指向 .db/.sqlite/.sqlite3 数据库文件");
  if (!write && !existsSync(file)) return null;
  if (write) mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { readOnly: !write, timeout: 5_000 });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const version = db.prepare("PRAGMA user_version").get().user_version;
    const applicationId = db.prepare("PRAGMA application_id").get().application_id;
    if (version === 0 && applicationId === 0) {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
      if (tables.length) throw new Error("目标文件不是 chart 行情数据库，拒绝修改");
      if (!write) { db.close(); return null; }
      db.exec(`
        PRAGMA journal_mode = WAL;
        BEGIN IMMEDIATE;
        CREATE TABLE market_state (
          id INTEGER PRIMARY KEY CHECK (id = 1), header TEXT NOT NULL,
          last_block INTEGER NOT NULL, total_events INTEGER NOT NULL,
          total_transactions INTEGER NOT NULL, total_trades INTEGER NOT NULL,
          revision INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE events (
          tx TEXT NOT NULL, log_index INTEGER NOT NULL,
          block_number INTEGER NOT NULL, timestamp INTEGER NOT NULL,
          kind TEXT NOT NULL, side TEXT, price REAL NOT NULL, quote_amount REAL NOT NULL,
          payload TEXT NOT NULL, PRIMARY KEY (tx, log_index), UNIQUE (block_number, log_index)
        ) STRICT;
        CREATE INDEX events_time ON events(timestamp, log_index);
        CREATE INDEX trades_time ON events(kind, timestamp, log_index);
        CREATE INDEX transactions_order ON events(block_number DESC, log_index DESC, timestamp DESC) WHERE kind <> 'sync';
        CREATE TABLE candles (
          interval TEXT NOT NULL, timestamp INTEGER NOT NULL, payload TEXT NOT NULL,
          PRIMARY KEY (interval, timestamp)
        ) STRICT;
        PRAGMA application_id = ${APPLICATION_ID};
        PRAGMA user_version = ${SCHEMA_VERSION};
        COMMIT;
      `);
    } else if (version !== SCHEMA_VERSION || applicationId !== APPLICATION_ID) {
      throw new Error(`不支持的行情数据库版本 ${version} 或文件类型不匹配`);
    }
    // FULL：提交断点前确保 WAL 落盘；Web 强制只读，不持有长事务。
    if (write) {
      db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL");
      // 向后兼容的附加表：旧 Web 仍能读，只有持 writer lock 的新版 Worker 创建。
      db.exec(`CREATE TABLE IF NOT EXISTS chain_checkpoints (
        block_number INTEGER PRIMARY KEY, hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
        header TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS worker_status (
        id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL
      ) STRICT;`);
    }
    else db.exec("PRAGMA query_only = ON");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** 多条 SELECT 也放在短读事务中，保证价格、计数、分页来自同一提交。 */
export function withMarketDatabase(config, write, operation) {
  const db = openMarketDatabase(config, { write });
  if (!db) return null;
  try {
    db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    const result = operation(db);
    if (result && typeof result.then === "function") throw new Error("数据库事务内不能等待 RPC 或其他异步操作");
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* 事务可能已由 SQLite 回滚。 */ }
    throw error;
  } finally {
    db.close();
  }
}
