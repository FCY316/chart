

export type Candle = { time: string; timestamp?: number; open: number; high: number; low: number; close: number; volume: number };
export type Transaction = { side: "Buy" | "Sell" | "Swap" | "AddLiquidity" | "RemoveLiquidity"; time: string; wallet: string; baseAmount: number; quoteAmount: number; price: number; tx: string; [key: string]: unknown };
export type MarketSnapshot = {
  metadata: { productName: string; pair: string; network: string; chainId: number; pairAddress: string; updatedAt: string; priceUnit?: string; baseToken: { name: string; symbol: string; decimals: number; address: string }; quoteToken: { name: string; symbol: string; decimals: number; address: string } };
  quote: { priceUsd: number | null; priceNative: number; priceQuote?: number; priceUnit?: string; change24h: number; high24h: number; low24h: number; volume24h?: number; marketCap: number | null; fullyDilutedValue: number | null };
  metrics: Array<{ label: string; value: string; detail: string; tone?: string }>;
  candles: Candle[];
  orderBook: { asks: Array<{ price: number; amount: number; total: number }>; bids: Array<{ price: number; amount: number; total: number }> };
  pool: {
    name: string;
    fee: string;
    initialPrice: number;
    createdAt: string;
    factoryAddress: string;
    lastBlock: number;
    reserves?: { base: number; quote: number; baseSymbol: string; quoteSymbol: string };
    [key: string]: unknown;
  };
  transactions: Transaction[];
  candlesByInterval?: Record<string, Candle[]>;
  history?: {
    events: Array<Record<string, unknown>>;
    lastBlock: number;
    lastSyncAt: string;
    totalEvents?: number;
    transactionsCursor?: string | null;
    historyMode?: "all";
    startBlock?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};
