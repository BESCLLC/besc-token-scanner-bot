import { ethers } from "ethers";

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

    // Collect unique addresses from recent logs
    const uniqueAddresses = new Set();
    for (const log of logs) {
      const { args } = decodeTransfer(log);
      if (args.from !== ethers.ZeroAddress) uniqueAddresses.add(args.from);
      if (args.to !== ethers.ZeroAddress) uniqueAddresses.add(args.to);
    }

    // Now query actual balances on-chain
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
      const bal = await tokenContract.balanceOf(addr);
      if (bal > 0n) {
        holders.push({ address: addr, balance: bal });
      }
    }

    // Sort by balance desc
    holders.sort((a, b) => (b.balance > a.balance ? 1 : -1));

    // Take top 5 and compute percentages
    return holders.slice(0, 5).map((h) => ({
      address: h.address,
      percent: Number((h.balance * 10000n) / totalSupply) / 100
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

    return logs.filter((log) => {
      const { args } = decodeTransfer(log);
      return args.from !== ethers.ZeroAddress;
    });
  } catch (e) {
    console.error("Error in detectDevSells:", e);
    return [];
  }
}

function decodeTransfer(log) {
  const iface = new ethers.Interface([
    "event Transfer(address indexed from, address indexed to, uint256 value)"
  ]);
  return iface.parseLog(log);
}
