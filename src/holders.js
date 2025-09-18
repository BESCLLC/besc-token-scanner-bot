import { ethers } from "ethers";

export async function getTopHolders(token, provider) {
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const logs = await provider.getLogs({
    address: token,
    fromBlock: "latest-5000",
    topics: [transferTopic]
  });

  const balances = {};
  for (const log of logs) {
    const { args } = decodeTransfer(log);
    balances[args.from] = (balances[args.from] || 0n) - args.value;
    balances[args.to] = (balances[args.to] || 0n) + args.value;
  }

  const sorted = Object.entries(balances)
    .filter(([addr, bal]) => bal > 0n)
    .sort((a, b) => (b[1] > a[1] ? 1 : -1))
    .slice(0, 5);

  const total = sorted.reduce((acc, [, b]) => acc + b, 0n);
  return sorted.map(([addr, bal]) => ({
    address: addr,
    percent: Number((bal * 10000n) / total) / 100
  }));
}

export async function detectDevSells(token, provider) {
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const logs = await provider.getLogs({
    address: token,
    fromBlock: "latest-2000",
    topics: [transferTopic]
  });

  return logs.filter(l => {
    const { args } = decodeTransfer(l);
    return args.from !== "0x0000000000000000000000000000000000000000"; // suspicious
  });
}

function decodeTransfer(log) {
  const iface = new ethers.Interface([
    "event Transfer(address indexed from, address indexed to, uint256 value)"
  ]);
  return iface.parseLog(log);
}
