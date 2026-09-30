import { bech32 } from "bech32";
import { getAddress, getBytes, hexlify } from "ethers";

export type AddressType = "0x" | "hg";

/** 与 Swap 项目相同：EVM 的 20 字节账户地址转为 hg 前缀的 Bech32 地址。 */
export function evmToHg(address: string): string {
  return bech32.encode("hg", bech32.toWords(getBytes(getAddress(address))));
}

/** 验证 Bech32 校验和、hg 前缀及账户长度，返回 EVM 校验和地址。 */
export function hgToEvm(address: string): string {
  const decoded = bech32.decode(address);
  if (decoded.prefix !== "hg") throw new Error("地址前缀必须是 hg");
  const bytes = Uint8Array.from(bech32.fromWords(decoded.words));
  if (bytes.length !== 20) throw new Error("账户地址必须为 20 字节");
  return getAddress(hexlify(bytes));
}

/** 只转换展示及复制的地址；异常时保留原值，不让单条坏数据阻塞交易列表。 */
export function convertAddress(address: string, addressType: AddressType): string {
  if (!address) return address;
  try {
    const isEvm = address.toLowerCase().startsWith("0x");
    const evmAddress = isEvm ? getAddress(address) : hgToEvm(address);
    return addressType === "hg" ? evmToHg(evmAddress) : evmAddress;
  } catch {
    return address;
  }
}
