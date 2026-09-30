import fs from "node:fs/promises";
import path from "node:path";

export function resolveDataFile(config) {
  return path.isAbsolute(config.dataFile) ? config.dataFile : path.resolve(process.cwd(), config.dataFile);
}

export async function readMarketSnapshot(config) {
  try {
    return JSON.parse(await fs.readFile(resolveDataFile(config), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    // 文件损坏不能误判为首次启动，避免意外覆盖。
    throw error;
  }
}

/** 通过临时文件再 rename，避免前端读到半截 JSON。 */
export async function writeMarketSnapshot(snapshot, config) {
  const file = resolveDataFile(config);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(snapshot), "utf8");
  await fs.rename(temporary, file);
}
