import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";
import axios from "axios";
import { getTopHolders, detectDevSells } from "./holders.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const erc20Abi = JSON.parse(fs.readFileSync(path.join(__dirname, "abi", "ERC20.json"), "utf8"));
const lpAbi = JSON.parse(fs.readFileSync(path.join(__dirname, "abi", "LP.json"), "utf8"));
const lockerAbi = JSON.parse(fs.readFileSync(path.join(__dirname, "abi", "Locker.json"), "utf8"));

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const BLOCKSCOUT_API = process.env.BLOCKSCOUT_API || "https://explorer.beschyperchain.com/api/v2";

export async function analyzeToken(tokenAddress) {
  tokenAddress = ethers.getAddress(tokenAddress);

  // --- token info from explorer
  const tokenInfo = await getTokenInfo(tokenAddress);
  const name = tokenInfo.name || "Unknown";
  const symbol = tokenInfo.symbol || "?";
  const totalSupply = tokenInfo.totalSupply;
  const decimals = tokenInfo.decimals;

  // --- onchain owner (if any)
  let owner = null;
  try {
    const token = new ethers.Contract(tokenAddress, erc20Abi, provider);
    owner = await token.owner();
  } catch {}

  // --- tax detection
  const { buyTaxPct, sellTaxPct } = await detectTaxes(tokenAddress);

  // --- LP analysis
  const lpResult = await findLPAndAnalyze(tokenAddress);

  // --- holders
  const holders = await getTopHolders(tokenAddress, 10);
  const devSells = await detectDevSells(tokenAddress, provider, owner, holders[0]?.address);

  return formatReport({
    name,
    symbol,
    totalSupply,
    decimals,
    owner,
    buyTaxPct,
    sellTaxPct,
    lpInfo: lpResult.status,
    lpTopHolders: lpResult.topHolders,
    holders,
    devSells
  });
}

async function getTokenInfo(address) {
  try {
    const url = `${BLOCKSCOUT_API}/tokens/${address}`;
    const res = await axios.get(url);
    if (res.data) {
      return {
        name: res.data.name,
        symbol: res.data.symbol,
        decimals: res.data.decimals,
        totalSupply: Number(res.data.total_supply) / 10 ** res.data.decimals
      };
    }
  } catch (e) {
    console.log("Failed to fetch token info:", e.message);
  }
  return { name: null, symbol: null, decimals: 18, totalSupply: null };
}

async function detectTaxes(tokenAddress) {
  const token = new ethers.Contract(tokenAddress, [
    "function liquidityFee() view returns (uint256)",
    "function marketingFee() view returns (uint256)",
    "function teamFee() view returns (uint256)",
    "function rewardsFee() view returns (uint256)",
    "function liquidityFeeSell() view returns (uint256)",
    "function marketingFeeSell() view returns (uint256)",
    "function teamFeeSell() view returns (uint256)",
    "function rewardsFeeSell() view returns (uint256)",
    "function totalFee() view returns (uint256)",
    "function totalFeeSell() view returns (uint256)"
  ], provider);

  let buy = 0, sell = 0;
  try { buy += Number(await token.liquidityFee()); } catch {}
  try { buy += Number(await token.marketingFee()); } catch {}
  try { buy += Number(await token.teamFee()); } catch {}
  try { buy += Number(await token.rewardsFee()); } catch {}
  try { buy += Number(await token.totalFee()); } catch {}

  try { sell += Number(await token.liquidityFeeSell()); } catch {}
  try { sell += Number(await token.marketingFeeSell()); } catch {}
  try { sell += Number(await token.teamFeeSell()); } catch {}
  try { sell += Number(await token.rewardsFeeSell()); } catch {}
  try { sell += Number(await token.totalFeeSell()); } catch {}

  return { buyTaxPct: buy || null, sellTaxPct: sell || null };
}

async function findLPAndAnalyze(tokenAddress) {
  let lpAddress = null;
  try {
    const factory = new ethers.Contract(process.env.FACTORY_ADDRESS, [
      "function allPairsLength() view returns (uint256)",
      "function allPairs(uint256) view returns (address)"
    ], provider);

    const count = Number(await factory.allPairsLength());
    for (let i = 0; i < count; i++) {
      const pair = await factory.allPairs(i);
      const lp = new ethers.Contract(pair, lpAbi, provider);
      const token0 = await lp.token0();
      const token1 = await lp.token1();
      if ([token0, token1].map(a => a.toLowerCase()).includes(tokenAddress.toLowerCase())) {
        lpAddress = pair;
        break;
      }
    }
  } catch (e) {
    console.log("LP scan error:", e.message);
  }

  if (!lpAddress) return { status: "⚠️ LP Not Found", topHolders: [] };

  // analyze LP
  return analyzeLP(lpAddress);
}

async function analyzeLP(lpAddress) {
  const lp = new ethers.Contract(lpAddress, lpAbi, provider);
  let totalSupply = 0n;
  try { totalSupply = await lp.totalSupply(); } catch {}

  const burnAddrs = ["0x000000000000000000000000000000000000dEaD", "0x0000000000000000000000000000000000000000"];
  let burned = 0n;
  for (const a of burnAddrs) {
    try { burned += await lp.balanceOf(a); } catch {}
  }
  const burnPercent = totalSupply > 0n ? Number((burned * 10000n) / totalSupply) / 100 : 0;
  if (burnPercent > 0) return { status: `🔥 LP Burned (${burnPercent.toFixed(2)}%)`, topHolders: [] };

  // try locker
  try {
    const locker = new ethers.Contract(process.env.LOCKER_ADDRESS, lockerAbi, provider);
    const events = await locker.queryFilter(locker.filters.Locked(), 0, "latest");
    const matches = events.filter(e => e.args.token.toLowerCase() === lpAddress.toLowerCase());

    if (matches.length > 0) {
      const totalLocked = matches.reduce((acc, e) => acc + e.args.amount, 0n);
      const latestUnlock = Math.max(...matches.map(e => Number(e.args.unlockTime)));
      const lockedPct = totalSupply > 0n ? Number((totalLocked * 10000n) / totalSupply) / 100 : 0;
      return {
        status: `✅ Locked ${lockedPct.toFixed(2)}% until <b>${new Date(latestUnlock * 1000).toUTCString()}</b>`,
        topHolders: []
      };
    }
  } catch {}

  // no burn/lock → top LP holders
  const topHolders = await fetchLpTopHolders(lpAddress, totalSupply);
  return { status: "⚠️ LP Not Locked or Burned", topHolders };
}

async function fetchLpTopHolders(lpAddress, totalSupply) {
  try {
    const topic = ethers.id("Transfer(address,address,uint256)");
    const logs = await provider.getLogs({
      address: lpAddress,
      fromBlock: Math.max((await provider.getBlockNumber()) - 30000, 0),
      toBlock: "latest",
      topics: [topic]
    });

    const balances = {};
    const iface = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
    for (const log of logs) {
      const parsed = iface.parseLog(log);
      if (parsed.args.from !== ethers.ZeroAddress)
        balances[parsed.args.from] = (balances[parsed.args.from] || 0n) - parsed.args.value;
      balances[parsed.args.to] = (balances[parsed.args.to] || 0n) + parsed.args.value;
    }

    return Object.entries(balances)
      .filter(([, bal]) => bal > 0n)
      .sort((a, b) => (b[1] > a[1] ? 1 : -1))
      .slice(0, 3)
      .map(([addr, bal]) => ({
        address: addr,
        percent: totalSupply > 0n ? Number((bal * 10000n) / totalSupply) / 100 : 0
      }));
  } catch {
    return [];
  }
}

function formatReport({ name, symbol, totalSupply, owner, buyTaxPct, sellTaxPct, lpInfo, lpTopHolders, holders, devSells }) {
  let risk = "🟢 SAFE";
  if (lpInfo.includes("⚠️") || (holders[0]?.percent ?? 0) > 50 || devSells.length > 0) risk = "🔴 DANGER";

  const taxLine = buyTaxPct == null && sellTaxPct == null
    ? "No public tax functions found"
    : `Buy ${buyTaxPct ?? "?"}% / Sell ${sellTaxPct ?? "?"}%`;

  const topHolderLines = holders.map(h => `• ${h.address} (${h.percent.toFixed(2)}%)`).join("\n") || "N/A";

  const lpHolderLines = lpTopHolders.length
    ? "\n<b>LP Top Holders:</b>\n" + lpTopHolders.map(h => `• ${h.address} (${h.percent.toFixed(2)}%)`).join("\n")
    : "";

  const devSellLine = devSells.length > 0 ? "🚨 Dev selling detected in last 24h" : "✅ No dev sells in last 24h";

  return `
<b>${risk}</b>

<b>${name} (${symbol})</b>

<b>Supply:</b> ${totalSupply?.toLocaleString() ?? "N/A"}
<b>Owner:</b> ${owner ?? "N/A"}
<b>Taxes:</b> ${taxLine}

<b>LP:</b> ${lpInfo}${lpHolderLines}

<b>Top Holders:</b>
${topHolderLines}

${devSellLine}
`;
}
