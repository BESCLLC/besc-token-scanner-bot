import axios from "axios";
import { ethers } from "ethers";

const BASE_URL =
  process.env.BLOCKSCOUT_API || "https://explorer.beschyperchain.com/api/v2";

/**
 * Fetch token info from BlockScout (name, symbol, supply, decimals)
 */
export async function getTokenInfo(tokenAddress) {
  try {
    const url = `${BASE_URL}/tokens/${tokenAddress}`;
    const res = await axios.get(url, { headers: { accept: "application/json" } });

    if (res.data) {
      const data = res.data;
      const decimals = Number(data.decimals || 18);
      const totalSupply = Number(data.total_supply) / 10 ** decimals;
      return {
        name: data.name || "Unknown",
        symbol: data.symbol || "???",
        decimals,
        totalSupply
      };
    }
  } catch (e) {
    console.log("BlockScout token info failed:", e.message);
  }
  return { name: "Unknown", symbol: "???", decimals: 18, totalSupply: 0 };
}

/**
 * Fetch top holders and calculate percentage ownership
 */
export async function getTopHolders(
  tokenAddress,
  limit = 10,
  totalSupply = null,
  decimals = 18
) {
  try {
    const url = `${BASE_URL}/tokens/${tokenAddress}/holders?page=1&page_size=${limit}`;
    const res = await axios.get(url, { headers: { accept: "application/json" } });

    if (res.data && Array.isArray(res.data.items)) {
      const supplyBN = totalSupply
        ? ethers.parseUnits(totalSupply.toString(), decimals)
        : null;

      // Map holders → {address, balance, percent}
      const mapped = res.data.items
        .map((h) => {
          const balanceBN = BigInt(h.value || "0");
          let percent = 0;
          if (supplyBN && supplyBN > 0n) {
            percent = Number((balanceBN * 10000n) / supplyBN) / 100; // 2 decimals
          }
          return {
            address: ethers.getAddress(h.address.hash),
            balance: Number(balanceBN) / 10 ** decimals,
            percent
          };
        })
        .filter((h) => h.balance > 0) // drop dust
        .sort((a, b) => b.balance - a.balance) // biggest first
        .slice(0, limit);

      // Special labeling for LP & dead wallet
      return mapped.map((h) => ({
        ...h,
        address:
          h.address.toLowerCase() ===
          "0x000000000000000000000000000000000000dead"
            ? "🔥 Burn Address"
            : h.address
      }));
    }
  } catch (e) {
    console.log("BlockScout holder API failed:", e.message);
  }
  return [];
}
