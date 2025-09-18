import { ethers } from "ethers";
import { bnToDecimal } from "./utils.js";

export async function getTopHolders(token, provider) {
  try {
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(latestBlock - 5000, 0);

    const transferTopic = ethers.id("Transfer(address,address,uint256)");
    const logs = await provider.getLogs({
      address: token,
      fromBlock,
      toBlock: latestBlock,
      topics: [transferTopic]
    });

    if (!logs.length) return [];

    // Collect unique addresses from logs
    const uniqueAddresses = new Set();
    const iface = new ethers.Interface([
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    ]);

    for (const log of logs) {
      const { args } = iface.parseLog(log);
      if (args.from !== ethers.ZeroAddress) uniqueAddresses.add(args.from);
      if (args.to !== ethers.ZeroAddress) uniqueAddresses.add(args.to);
    }

    // Get actual balances on-chain
    const tokenContract = new ethers.Contract(
      token,
      [
        "function balanceOf(address) view returns (uint256)",
        "function totalSupply() view returns (uint256)"
      ],
      provider
    );

    const totalSupply = await tokenContract.totalSupply();
    const holders = [];

    for (const addr of uniqueAddresses) {
      let bal = 0n;
      try {
        bal = await tokenContract.balanceOf(addr);
      } catch {}
      if (bal > 0n) {
        holders.push({ address: addr, balance: bal });
      }
    }

    holders.sort((a, b) => (b.balance > a.balance ? 1 : -1));

    // Calculate percentages
    return holders.slice(0, 5).map((h) => ({
      address: h.address,
      percent: Number((h.balance * 10000n) / (totalSupply || 1n)) / 100
    }));
  } catch (e) {
    console.error("Error in getTopHolders:", e);
    return [];
  }
}

export async function detectDevSells(token, provider) {
  try {
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(latestBlock - 2000, 0);

    const transferTopic = ethers.id("Transfer(address,address,uint256)");
    const logs = await provider.getLogs({
      address: token,
      fromBlock,
      toBlock: latestBlock,
      topics: [transferTopic]
    });

    if (!logs.length) return [];

    const iface = new ethers.Interface([
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    ]);
    const transfers = logs.map((l) => iface.parseLog(l).args);

    // Identify likely dev wallets: owner() + top 3 senders in this window
    const tokenContract = new ethers.Contract(
      token,
      ["function owner() view returns (address)"],
      provider
    );

    let ownerAddress = null;
    try {
      ownerAddress = await tokenContract.owner();
    } catch {
      ownerAddress = null; // token has no owner() function
    }

    const senderCounts = {};
    for (const t of transfers) {
      senderCounts[t.from] = (senderCounts[t.from] || 0n) + t.value;
    }

    const topSenders = Object.entries(senderCounts)
      .sort((a, b) => (b[1] > a[1] ? 1 : -1))
      .slice(0, 3)
      .map(([addr]) => addr);

    const likelyDevWallets = new Set([
      ...(ownerAddress ? [ethers.getAddress(ownerAddress)] : []),
      ...topSenders
    ].map(a => ethers.getAddress(a)));

    const suspectedSells = [];

    for (const t of transfers) {
      if (!likelyDevWallets.has(ethers.getAddress(t.from))) continue;

      // optional: filter for sells to LP pairs / known routers
      // You can add known router addresses to this list to avoid false positives
      const isSell =
        t.to !== ethers.ZeroAddress &&
        t.value > 0n;

      if (isSell) {
        suspectedSells.push({
          from: t.from,
          to: t.to,
          value: t.value
        });
      }
    }

    return suspectedSells;
  } catch (e) {
    console.error("Error in detectDevSells:", e);
    return [];
  }
}
