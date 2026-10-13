export const DEFAULT_CANDLE_LIMIT = 1_000;
export const MAX_CANDLE_LIMIT = 2_000;
export const DEFAULT_TRANSACTION_LIMIT = 50;
export const MAX_TRANSACTION_LIMIT = 200;

export function parseLimit(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function decodeTransactionCursor(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { blockNumber?: number; logIndex?: number };
    if (!Number.isSafeInteger(parsed.blockNumber) || !Number.isSafeInteger(parsed.logIndex) || Number(parsed.blockNumber) < 0 || Number(parsed.logIndex) < 0) return null;
    return { blockNumber: Number(parsed.blockNumber), logIndex: Number(parsed.logIndex) };
  } catch {
    return null;
  }
}
