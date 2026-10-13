import { INTERVALS } from "./config.mjs";
import { withMarketDatabase } from "./database.mjs";
import { backupMarketDatabase } from "./data-maintenance.mjs";
import { assertMarketIdentity, readStateRow } from "./repository.mjs";

/** 调用方须先持有 writer lock。仅修复派生成交量，不改 OHLC、事件或扫块断点。 */
export async function ensureCandleVolumes(config) {
  const previous = withMarketDatabase(config, false, (db) => {
    const state = readStateRow(db);
    if (state) assertMarketIdentity(JSON.parse(state.header), config);
    return state;
  });
  if (!previous || JSON.parse(previous.header).history?.candleVolumeVersion === 1) return { changed: false };
  // 备份失败便不写入；旧库升级只执行一次，正常逐块更新不扫描历史。
  const backup = await backupMarketDatabase(config);
  const candles = withMarketDatabase(config, true, (db) => {
    const state = readStateRow(db);
    if (state?.revision !== previous.revision) throw new Error("成交量修复期间数据库已改变，请停止其他写入进程后重试");
    const update = db.prepare("UPDATE candles SET payload = json_set(payload, '$.volume', ?, '$.trades', ?) WHERE interval = ? AND timestamp = ?");
    let count = 0;
    for (const [interval, seconds] of Object.entries(INTERVALS)) {
      const volumes = new Map(db.prepare(`SELECT CAST(timestamp / ? AS INTEGER) * ? AS bucket,
        sum(quote_amount) AS volume, count(*) AS trades FROM events
        WHERE kind = 'swap' GROUP BY bucket`).all(seconds, seconds).map((row) => [row.bucket, row]));
      for (const { timestamp } of db.prepare("SELECT timestamp FROM candles WHERE interval = ?").all(interval)) {
        const value = volumes.get(timestamp);
        update.run(value?.volume ?? 0, value?.trades ?? 0, interval, timestamp);
        count += 1;
      }
    }
    const header = JSON.parse(state.header);
    header.history.candleVolumeVersion = 1;
    header.history.volumeUnit = header.metadata.quoteToken.symbol;
    db.prepare("UPDATE market_state SET header = ?, revision = revision + 1 WHERE id = 1").run(JSON.stringify(header));
    return count;
  });
  return { changed: true, backup, candles };
}
