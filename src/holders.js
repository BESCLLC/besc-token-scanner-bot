import axios from "axios";
import { ethers } from "ethers";

const BASE_URL = process.env.BLOCKSCOUT_API || "https://explorer.beschyperchain.com/api/v2";

/**
 * Fetch top holders from BlockScout and calculate percentages
 * @param {string} tokenAddress - ERC20 token address
 * @param {number} limit - number of top holders to return
 * @param {bigint} totalSupply - token total supply (normalized)
 * @param {number} decimals - token decimals
 */
export async function getTopHolders(tokenAddress, limit = 10, totalSupply = null, decimals = 18) {
  try {
    const url = `${BASE_URL}/tokens/${tokenAddress}/holders?page=1&page_size=50`;
    const res = await axios.get(url, { headers: { accept: "application/json" } });

    if (res.data && Array.isArray(res.data.items)) {
      const supplyBN = totalSupply
        ? ethers.parseUnits(totalSupply.toString(), decimals)
        : null;

      return res.data.items
        .map((h) => {
          const balanceBN = BigInt(h.value || "0");
          let percent = 0;
          if (supplyBN && supplyBN > 0n) {
            percent = Number((balanceBN * 10000n) / supplyBN) / 100; // 2 decimal places
          }
          return {
            address: ethers.getAddress(h.address.hash),
            balance: balanceBN,
            percent,
          };
        })
        .filter((h) => h.percent >= 0.01) // ignore dust wallets
        .slice(0, limit);
    }
  } catch (e) {
    console.error("❌ BlockScout holder API failed:", e.message);
  }
  return [];
}

/**
 * Fetch token metadata (name, symbol, supply, decimals) from BlockScout
 */
export async function getTokenInfo(tokenAddress) {
  try {
    const url = `${BASE_URL}/tokens/${tokenAddress}`;
    const res = await axios.get(url, { headers: { accept: "application/json" } });

    if (res.data) {
      return {
        name: res.data.name,
        symbol: res.data.symbol,
        decimals: res.data.decimals,
        totalSupply: Number(res.data.total_supply) / 10 ** res.data.decimals,
      };
    }
  } catch (e) {
    console.error("❌ BlockScout token info failed:", e.message);
  }
  return { name: null, symbol: null, decimals: 18, totalSupply: null };
}
