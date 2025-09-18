import axios from "axios";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const BASE_URL = process.env.BLOCKSCOUT_API || "https://explorer.beschyperchain.com/api/v2";

/**
 * Fetch token info from RPC with safe fallbacks.
 */
export async function getTokenInfo(tokenAddress) {
  const erc20Abi = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)"
  ];

  const token = new ethers.Contract(tokenAddress, erc20Abi, provider);

  const [name, symbol, decimals, totalSupply] = await Promise.all([
    safeCall(() => token.name(), "Unknown"),
    safeCall(() => token.symbol(), "Unknown"),
    safeCall(() => token.decimals(), 18),
    safeCall(() => token.totalSupply(), 0n)
  ]);

  return {
    name,
    symbol,
    decimals,
    totalSupply: Number(ethers.formatUnits(totalSupply, decimals))
  };
}

/**
 * Fetch top token holders from BlockScout API with pagination.
 * Tags LP, burn address, and contracts for readability.
 */
export async function getTopHolders(tokenAddress, limit = 10, totalSupply, decimals) {
  try {
    const url = `${BASE_URL}/tokens/${tokenAddress}/holders?page=1&limit=${limit}`;
    const res = await axios.get(url);

    // Debug log to see exactly what the explorer returns
    if (process.env.DEBUG === "true") {
      console.log("📡 BlockScout Holders API Raw:", JSON.stringify(res.data, null, 2));
    }

    if (!res.data.items || res.data.items.length === 0) {
      console.warn("⚠️ No holders returned by BlockScout for", tokenAddress);
      return [];
    }

    const holders = res.data.items.map((h) => {
      // Fallback to decimals = 18 if explorer doesn't return value in correct format
      const balance = Number(ethers.formatUnits(h.value || "0", decimals || 18));
      const percent = totalSupply > 0 ? (balance / totalSupply) * 100 : 0;

      let label = h.address;
      if (h.address.toLowerCase() === "0x000000000000000000000000000000000000dead") {
        label = "🔥 Burn Address";
      }
      if (h.name && h.name.toLowerCase().includes("sushi")) {
        label = "🍣 SushiSwap LP Token";
      }
      if (h.is_contract) {
        label += " [Contract]";
      }

      return {
        address: label,
        rawAddress: h.address,
        balance,
        percent
      };
    });

    // Sort descending by balance
    return holders.sort((a, b) => b.balance - a.balance);
  } catch (err) {
    console.error("❌ getTopHolders failed:", err.message);
    return [];
  }
}

/** Safe call wrapper to avoid crashing on view call errors */
async function safeCall(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
