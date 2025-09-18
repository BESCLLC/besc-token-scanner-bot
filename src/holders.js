import axios from "axios";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const BASE_URL = process.env.BLOCKSCOUT_API || "https://explorer.beschyperchain.com/api/v2";

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

export async function getTopHolders(tokenAddress, limit = 7, totalSupply, decimals) {
  try {
    const url = `${BASE_URL}/tokens/${tokenAddress}/holders?page=1&limit=100`; // fetch more, then trim
    const res = await axios.get(url);

    if (!res.data.items || res.data.items.length === 0) {
      console.warn("⚠️ No holders returned by BlockScout for", tokenAddress);
      return [];
    }

    const allHolders = res.data.items.map((h) => {
      let addr =
        typeof h.address === "string"
          ? h.address
          : h.address?.hash || h.address?.address || "Unknown";

      const balance = Number(ethers.formatUnits(h.value || "0", decimals || 18));
      const percent = totalSupply > 0 ? (balance / totalSupply) * 100 : 0;

      let label = `<a href="${BASE_URL.replace("/api/v2", "")}/address/${addr}" target="_blank">${addr}</a>`;
      if (addr.toLowerCase() === "0x000000000000000000000000000000000000dead") {
        label = "🔥 Burn Address";
      }
      if (h.name && h.name.toLowerCase().includes("sushi")) {
        label = "🍣 SushiSwap LP Token";
      }
      if (h.is_contract && addr.toLowerCase() !== "0x000000000000000000000000000000000000dead") {
        label += " [Contract]";
      }

      return {
        address: addr,
        label,
        balance,
        percent
      };
    });

    // 🔧 Sort and take top N holders only
    return allHolders
      .sort((a, b) => b.balance - a.balance)
      .slice(0, limit);  // ✅ THIS ENFORCES TOP N HOLDERS ONLY
  } catch (err) {
    console.error("❌ getTopHolders failed:", err.message);
    return [];
  }
}

async function safeCall(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
