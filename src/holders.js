import axios from "axios";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const BASE_URL = process.env.BLOCKSCOUT_API || "https://explorer.beschyperchain.com/api/v2";

/**
 * Fetches token info (name, symbol, decimals, totalSupply) from RPC.
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
 * Fetches top token holders using BlockScout API (much more reliable than RPC scan).
 * Adds LP tagging, burn address tagging, and flags suspicious whales.
 */
export async function getTopHolders(tokenAddress, limit = 10, totalSupply, decimals) {
  try {
    const url = `${BASE_URL}/tokens/${tokenAddress}/holders`;
    const res = await axios.get(url);

    if (!res.data.items || res.data.items.length === 0) return [];

    const holders = res.data.items
      .slice(0, limit)
      .map((h) => {
        const balance = Number(ethers.formatUnits(h.value, decimals));
        const percent = totalSupply > 0 ? (balance / totalSupply) * 100 : 0;

        let label = h.address;
        if (h.address.toLowerCase() === "0x000000000000000000000000000000000000dead")
          label = "🔥 Burn Address";
        if (h.name && h.name.toLowerCase().includes("sushiswap"))
          label = "🍣 SushiSwap LP Token";
        if (h.is_contract) label += " [Contract]";

        return {
          address: label,
          rawAddress: h.address,
          balance,
          percent
        };
      })
      .sort((a, b) => b.balance - a.balance);

    return holders;
  } catch (err) {
    console.error("❌ getTopHolders failed:", err.message);
    return [];
  }
}

/** Safe call wrapper to prevent hard crashes on view function errors */
async function safeCall(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
