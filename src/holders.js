import axios from "axios";
import { ethers } from "ethers";

const BASE_URL = process.env.BLOCKSCOUT_API || "https://explorer.beschyperchain.com/api/v2";

/**
 * Get top token holders directly from BlockScout API
 */
export async function getTopHolders(tokenAddress, limit = 10) {
  try {
    const url = `${BASE_URL}/tokens/${tokenAddress}/holders?page=1&page_size=${limit}`;
    const res = await axios.get(url, { headers: { accept: "application/json" } });

    if (res.data && Array.isArray(res.data.items)) {
      return res.data.items.map(h => ({
        address: ethers.getAddress(h.address.hash),
        balance: h.value || "0",
        percent: parseFloat(h.value.percent || "0")
      }));
    }
  } catch (e) {
    console.log("BlockScout holder API failed:", e.message);
  }
  return [];
}

/**
 * Detect if dev / deployer wallets have sold in last 24h
 * We check token transfers FROM the deployer or top holder
 */
export async function detectDevSells(tokenAddress, provider, deployer, topHolder) {
  const suspectWallets = [];
  if (deployer) suspectWallets.push(deployer.toLowerCase());
  if (topHolder) suspectWallets.push(topHolder.toLowerCase());
  if (!suspectWallets.length) return [];

  try {
    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(latest - 7200, 0); // roughly 24h window
    const topic = ethers.id("Transfer(address,address,uint256)");

    const logs = await provider.getLogs({
      address: tokenAddress,
      fromBlock,
      toBlock: "latest",
      topics: [topic]
    });

    return logs.filter(log => {
      const from = "0x" + log.topics[1].slice(26).toLowerCase();
      return suspectWallets.includes(from);
    });
  } catch (e) {
    console.log("Dev sell check failed:", e.message);
    return [];
  }
}
