import { Interface, id } from "ethers";

/** PancakeSwap V2 Pair 的最小 ABI。 */
export const PANCAKE_V2_PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function factory() view returns (address)",
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
  "event Mint(address indexed sender, uint256 amount0, uint256 amount1)",
  "event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)",
  "event Sync(uint112 reserve0, uint112 reserve1)",
];

/** 标准 ERC-20 元数据 ABI。 */
export const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

export const pairInterface = new Interface(PANCAKE_V2_PAIR_ABI);
export const EVENT_TOPICS = [
  id("Swap(address,uint256,uint256,uint256,uint256,address)"),
  id("Mint(address,uint256,uint256)"),
  id("Burn(address,uint256,uint256,address)"),
  id("Sync(uint112,uint112)"),
];
