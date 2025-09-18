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

  // Basic token data
  const [name, symbol, totalSupply, owner] = await Promise.all([
    tryRead(() => token.name()),
    tryRead(() => token.symbol()),
    tryRead(() => token.totalSupply()),
    tryRead(() => token.owner())
  ]);

  // Expanded tax detection
  const { buyTaxPct, sellTaxPct } = await detectTaxes(tokenAddress);

  // Try to find LP pair
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
  } catch (err) {
    console.log("⚠️ LP pair scan failed:", err);
  }

  let lpInfo = "❌ LP Not Found";
  let lpTopHolders = [];
  let lpBurnPercent = 0;
  if (lpAddress) {
    const result = await analyzeLP(lpAddress);
    lpInfo = result.status;
    lpBurnPercent = result.burnPercent;
    lpTopHolders = result.topHolders || [];
  }

  // Holders + Dev sell detection
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
  const signatures = [
    "function buyTax() view returns (uint256)",
    "function _buyTax() view returns (uint256)",
    "function getBuyTax() view returns (uint256)",
    "function totalBuyTax() view returns (uint256)",
    "function buyFee() view returns (uint256)",
    "function taxFee() view returns (uint256)",
    "function getTotalFee() view returns (uint256)"
  ];
  const sellSignatures = [
    "function sellTax() view returns (uint256)",
    "function _sellTax() view returns (uint256)",
    "function getSellTax() view returns (uint256)",
    "function totalSellTax() view returns (uint256)",
    "function sellFee() view returns (uint256)",
    "function liquidityFee() view returns (uint256)"
  ];

  const buyTax = await tryAny(tokenAddress, signatures);
  const sellTax = await tryAny(tokenAddress, sellSignatures);

  return {
    buyTaxPct: buyTax != null ? normalizeTax(buyTax) : null,
    sellTaxPct: sellTax != null ? normalizeTax(sellTax) : null
  };
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

function normalizeTax(value) {
  const v = BigInt(value);
  if (v <= 100n) return Number(v);
  if (v <= 10000n) return Number(v) / 100;
  if (v <= 100000n) return Number(v) / 1000;
  return Number(v); // fallback
}

async function analyzeLP(lpAddress) {
  const lp = new ethers.Contract(lpAddress, lpAbi, provider);
  const burnAddresses = [
    "0x000000000000000000000000000000000000dEaD",
    "0x0000000000000000000000000000000000000000"
  ];

  let totalSupply = 0n;
  try {
    totalSupply = await lp.totalSupply();
  } catch {}

  let burned = 0n;
  for (const addr of burnAddresses) {
    try {
      const bal = await lp.balanceOf(addr);
      burned += bal;
    } catch {}
  }

  let burnPercent = 0;
  if (totalSupply > 0n) {
    burnPercent = Number((burned * 10000n) / totalSupply) / 100;
  }

  if (burnPercent >= 0.01) {
    return { status: `🔥 LP Burned (${burnPercent.toFixed(2)}%)`, burnPercent };
  } else if (burnPercent > 0) {
    return { status: "🔥 LP Burned (dust amount <0.01%)", burnPercent };
  }

  // LP not burned, get top holders of LP tokens
  const topHolders = await getLpTopHolders(lpAddress, totalSupply);
  return {
    status: "⚠️ LP Not Locked or Burned",
    burnPercent,
    topHolders
  };
}

async function getLpTopHolders(lpAddress, totalSupply) {
  try {
    const transferTopic = ethers.id("Transfer(address,address,uint256)");
    const logs = await provider.getLogs({
      address: lpAddress,
      fromBlock: Math.max((await provider.getBlockNumber()) - 30000, 0),
      toBlock: "latest",
      topics: [transferTopic]
    });

    const balances = {};
    for (const log of logs) {
      const iface = new ethers.Interface([
        "event Transfer(address indexed from, address indexed to, uint256 value)"
      ]);
      const parsed = iface.parseLog(log);
      if (parsed.args.from !== ethers.ZeroAddress) {
        balances[parsed.args.from] = (balances[parsed.args.from] || 0n) - parsed.args.value;
      }
      balances[parsed.args.to] = (balances[parsed.args.to] || 0n) + parsed.args.value;
    }

    const sorted = Object.entries(balances)
      .filter(([, bal]) => bal > 0n)
      .sort((a, b) => (b[1] > a[1] ? 1 : -1))
      .slice(0, 3)
      .map(([addr, bal]) => ({
        address: addr,
        percent: totalSupply > 0n ? Number((bal * 10000n) / totalSupply) / 100 : 0
      }));

    return sorted;
  } catch (e) {
    console.log("LP holder scan failed:", e);
    return [];
  }
}

function formatReport({ name, symbol, totalSupply, owner, buyTaxPct, sellTaxPct, lpInfo, lpBurnPercent, lpTopHolders, holders, devSells }) {
  let riskLevel = "🟢 SAFE";
  if (lpInfo.includes("⚠️") || (holders[0]?.percent ?? 0) > 50 || devSells.length > 0) {
    riskLevel = "🔴 DANGER";
  } else if (lpBurnPercent < 50 && lpBurnPercent > 0) {
    riskLevel = "🟡 CAUTION";
  }

  const taxLine =
    buyTaxPct == null && sellTaxPct == null
      ? "No public tax functions found"
      : `Buy ${buyTaxPct ?? "?"}% / Sell ${sellTaxPct ?? "?"}%`;

  const topHolders =
    holders.length > 0
      ? holders.map((h) => `• <code>${h.address}</code> (${h.percent.toFixed(2)}%)`).join("\n")
      : "N/A";

  const lpHolderLine =
    lpTopHolders.length > 0
      ? "\n<b>LP Top Holders:</b>\n" +
        lpTopHolders.map((h) => `• <code>${h.address}</code> (${h.percent.toFixed(2)}%)`).join("\n")
      : "";

  const devSellNote =
    devSells.length > 0
      ? `🚨 <b>Dev selling detected in last 24h</b>`
      : "✅ No dev sells in last 24h";

  return `
<b>${riskLevel}</b>

<b>${name ?? "Unknown Token"} (${symbol ?? "?"})</b>

<b>Supply:</b> ${totalSupply ? Number(totalSupply) / 1e18 : "N/A"}
<b>Owner:</b> ${owner ?? "N/A"}
<b>Taxes:</b> ${taxLine}

<b>LP:</b> ${lpInfo}${lpHolderLine}

<b>Top Holders:</b>
${topHolders}

${devSellNote}
`;
}
