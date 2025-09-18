import { ethers } from "ethers";

export async function getTopHolders(token, provider) {
  try {
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(latestBlock - 5000, 0); // safe lower bound

    const transferTopic = ethers.id("Transfer(address,address,uint256)");
    const logs = await provider.getLogs({
      address: token,
      fromBlock,
      toBlock: latestBlock,
      topics: [transferTopic]
    });

    if (!logs.length) return []; // no transfers yet

    const balances = {};
    for (const log of logs) {
      const { args } = decodeTransfer(log);
      if (args.from !== ethers.ZeroAddress) {
        balances[args.from] = (balances[args.from] || 0n) - args.value;
      }
      balances[args.to] = (balances[args.to] || 0n) + args.value;
    }

    const sorted = Object.entries(balances)
      .filter(([addr, bal]) => bal > 0n)
      .sort((a, b) => (b[1] > a[1] ? 1 : -1))
      .slice(0, 5);

    const total = sorted.reduce((acc, [, b]) => acc + b, 0n) || 1n;
    return sorted.map(([addr, bal]) => ({
      address: addr,
      percent: Number((bal * 10000n) / total) / 100
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

    // In real production: filter by known dev wallet(s)
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
