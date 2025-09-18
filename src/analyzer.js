import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";
import { tryRead } from "./utils.js";
import { getTopHolders, detectDevSells } from "./holders.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const erc20Abi = JSON.parse(fs.readFileSync(path.join(__dirname, "abi", "ERC20.json"), "utf8"));
const lpAbi = JSON.parse(fs.readFileSync(path.join(__dirname, "abi", "LP.json"), "utf8"));
const lockerAbi = JSON.parse(fs.readFileSync(path.join(__dirname, "abi", "Locker.json"), "utf8"));

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

export async function analyzeToken(tokenAddress) {
  tokenAddress = ethers.getAddress(tokenAddress);
  const token = new ethers.Contract(tokenAddress, erc20Abi, provider);

  // --- basics
  const [name, symbol, totalSupply, owner] = await Promise.all([
    tryRead(() => token.name()),
    tryRead(() => token.symbol()),
    tryRead(() => token.totalSupply()),
    tryRead(() => token.owner())
  ]);

  // --- taxes
  const { buyTaxPct, sellTaxPct } = await detectTaxes(tokenAddress);

  // --- LP detection
  let lpAddress = null;
  try {
    const factory = new ethers.Contract(process.env.FACTORY_ADDRESS, [
      "function allPairsLength() view returns (uint256)",
      "function allPairs(uint256) view returns (address)"
    ], provider);
    const pairsCount = Number(await factory.allPairsLength());
    for (let i = 0; i < pairsCount; i++) {
      const pair = await factory.allPairs(i);
      const lp = new ethers.Contract(pair, lpAbi, provider);
      const token0 = await lp.token0();
      const token1 = await lp.token1();
      if (
        token0.toLowerCase() === tokenAddress.toLowerCase() ||
        token1.toLowerCase() === tokenAddress.toLowerCase()
      ) {
        lpAddress = pair;
        break;
      }
    }
  } catch (e) {
    console.log("LP scan error:", e);
  }

  let lpInfo = "❌ LP Not Found";
  let lpTopHolders = [];
  let lpBurnPercent = 0;
  if (lpAddress) {
    const lpResult = await analyzeLP(lpAddress);
    lpInfo = lpResult.status;
    lpBurnPercent = lpResult.burnPercent;
    lpTopHolders = lpResult.topHolders || [];
  }

  // --- holders
  const holders = await getTopHolders(tokenAddress, provider);
  const devSells = await detectDevSells(tokenAddress, provider, owner, holders[0]?.address);

  return formatReport({
    name,
    symbol,
    totalSupply,
    owner,
    buyTaxPct,
    sellTaxPct,
    lpInfo,
    lpBurnPercent,
    lpTopHolders,
    holders,
    devSells
  });
}

async function detectTaxes(tokenAddress) {
  const candidatesBuy = [
    "function buyTax() view returns (uint256)",
    "function _buyTax() view returns (uint256)",
    "function getBuyTax() view returns (uint256)",
    "function totalBuyTax() view returns (uint256)",
    "function buyFee() view returns (uint256)",
    "function taxFee() view returns (uint256)",
    "function getTotalFee() view returns (uint256)"
  ];
  const candidatesSell = [
    "function sellTax() view returns (uint256)",
    "function _sellTax() view returns (uint256)",
    "function getSellTax() view returns (uint256)",
    "function totalSellTax() view returns (uint256)",
    "function sellFee() view returns (uint256)",
    "function liquidityFee() view returns (uint256)"
  ];

  const buy = await tryAny(tokenAddress, candidatesBuy);
  const sell = await tryAny(tokenAddress, candidatesSell);
  return { buyTaxPct: buy != null ? normalizeTax(buy) : null, sellTaxPct: sell != null ? normalizeTax(sell) : null };
}

async function tryAny(address, signatures) {
  for (const sig of signatures) {
    try {
      const iface = new ethers.Interface([sig]);
      const data = iface.encodeFunctionData(iface.getFunctionName(sig));
      const result = await provider.call({ to: address, data });
      const [decoded] = iface.decodeFunctionResult(iface.getFunctionName(sig), result);
      return decoded;
    } catch {}
  }
  return null;
}

function normalizeTax(v) {
  const n = BigInt(v);
  if (n <= 100n) return Number(n);
  if (n <= 10000n) return Number(n) / 100;
  if (n <= 100000n) return Number(n) / 1000;
  return Number(n);
}

async function analyzeLP(lpAddress) {
  const lp = new ethers.Contract(lpAddress, lpAbi, provider);
  let totalSupply = 0n;
  try {
    totalSupply = await lp.totalSupply();
  } catch {}

  // --- burn check
  const burnAddrs = ["0x000000000000000000000000000000000000dEaD", "0x0000000000000000000000000000000000000000"];
  let burned = 0n;
  for (const a of burnAddrs) {
    try {
      const bal = await lp.balanceOf(a);
      burned += bal;
    } catch {}
  }
  const burnPercent = totalSupply > 0n ? Number((burned * 10000n) / totalSupply) / 100 : 0;

  if (burnPercent >= 0.01) {
    return { status: `🔥 LP Burned (${burnPercent.toFixed(2)}%)`, burnPercent };
  } else if (burnPercent > 0) {
    return { status: "🔥 LP Burned (dust amount <0.01%)", burnPercent };
  }

  // --- locker check
  try {
    const locker = new ethers.Contract(process.env.LOCKER_ADDRESS, lockerAbi, provider);
    const events = await locker.queryFilter(locker.filters.Locked(), 0, "latest");
    const matching = events.filter((e) => e.args && e.args.token.toLowerCase() === lpAddress.toLowerCase());

    if (matching.length > 0) {
      let totalLocked = 0n;
      let latestUnlock = 0;
      for (const ev of matching) {
        totalLocked += ev.args.amount;
        if (Number(ev.args.unlockTime) > latestUnlock) latestUnlock = Number(ev.args.unlockTime);
      }
      const lockedPercent = totalSupply > 0n ? Number((totalLocked * 10000n) / totalSupply) / 100 : 0;
      const unlockDate = new Date(latestUnlock * 1000);
      return {
        status: `✅ Locked ${lockedPercent.toFixed(2)}% until <b>${unlockDate.toUTCString()}</b>`,
        burnPercent: 0
      };
    }
  } catch (e) {
    console.log("Locker scan error:", e);
  }

  // --- top LP holders
  const topHolders = await getLpTopHolders(lpAddress, totalSupply);
  return { status: "⚠️ LP Not Locked or Burned", burnPercent, topHolders };
}

async function getLpTopHolders(lpAddress, totalSupply) {
  try {
    const topic = ethers.id("Transfer(address,address,uint256)");
    const logs = await provider.getLogs({
      address: lpAddress,
      fromBlock: Math.max((await provider.getBlockNumber()) - 30000, 0),
      toBlock: "latest",
      topics: [topic]
    });

    const balances = {};
    for (const log of logs) {
      const iface = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
      const parsed = iface.parseLog(log);
      if (parsed.args.from !== ethers.ZeroAddress) {
        balances[parsed.args.from] = (balances[parsed.args.from] || 0n) - parsed.args.value;
      }
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

function formatReport({ name, symbol, totalSupply, owner, buyTaxPct, sellTaxPct, lpInfo, lpBurnPercent, lpTopHolders, holders, devSells }) {
  let risk = "🟢 SAFE";
  if (lpInfo.includes("⚠️") || (holders[0]?.percent ?? 0) > 50 || devSells.length > 0) risk = "🔴 DANGER";
  else if (lpBurnPercent > 0 && lpBurnPercent < 50) risk = "🟡 CAUTION";

  const taxLine = buyTaxPct == null && sellTaxPct == null
    ? "No public tax functions found"
    : `Buy ${buyTaxPct ?? "?"}% / Sell ${sellTaxPct ?? "?"}%`;

  const topHolders = holders.length
    ? holders.map((h) => `• <code>${h.address}</code> (${h.percent.toFixed(2)}%)`).join("\n")
    : "N/A";

  const lpHolderLines = lpTopHolders.length
    ? "\n<b>LP Top Holders:</b>\n" + lpTopHolders.map((h) => `• <code>${h.address}</code> (${h.percent.toFixed(2)}%)`).join("\n")
    : "";

  const devSellNote = devSells.length > 0 ? "🚨 <b>Dev selling detected in last 24h</b>" : "✅ No dev sells in last 24h";

  return `
<b>${risk}</b>

<b>${name ?? "Unknown Token"} (${symbol ?? "?"})</b>

<b>Supply:</b> ${totalSupply ? Number(totalSupply) / 1e18 : "N/A"}
<b>Owner:</b> ${owner ?? "N/A"}
<b>Taxes:</b> ${taxLine}

<b>LP:</b> ${lpInfo}${lpHolderLines}

<b>Top Holders:</b>
${topHolders}

${devSellNote}
`;
}
