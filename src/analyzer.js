import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";
import { tryRead } from "./utils.js";
import { getTopHolders, detectDevSells } from "./holders.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Load ABIs safely (no assert required)
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

  // Tax checks (if they exist)
  const buyTax = await tryRead(() => token.buyTax?.());
  const sellTax = await tryRead(() => token.sellTax?.());

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
  let lpBurnPercent = 0;
  if (lpAddress) {
    const { status, burnPercent } = await analyzeLP(lpAddress);
    lpInfo = status;
    lpBurnPercent = burnPercent;
  }

  // Holders + Dev sell detection
  const holders = await getTopHolders(tokenAddress, provider);
  const devSells = await detectDevSells(tokenAddress, provider);

  return formatReport({
    name,
    symbol,
    totalSupply,
    owner,
    buyTax,
    sellTax,
    lpInfo,
    lpBurnPercent,
    holders,
    devSells
  });
}

async function analyzeLP(lpAddress) {
  const lp = new ethers.Contract(lpAddress, lpAbi, provider);
  const burnAddresses = [
    "0x000000000000000000000000000000000000dEaD",
    "0x0000000000000000000000000000000000000000"
  ];

  try {
    const totalSupply = await lp.totalSupply();

    for (const addr of burnAddresses) {
      const bal = await lp.balanceOf(addr);
      if (bal > 0n) {
        const percent = Number((bal * 10000n) / totalSupply) / 100;
        return { status: `🔥 LP Burned (${percent.toFixed(2)}%)`, burnPercent: percent };
      }
    }
  } catch (err) {
    console.log("LP burn check failed:", err);
  }

  // Locker check fallback
  try {
    const locker = new ethers.Contract(process.env.LOCKER_ADDRESS, lockerAbi, provider);
    const events = await locker.queryFilter("Locked", 0, "latest");
    const lock = events.find(e => e.args.token.toLowerCase() === lpAddress.toLowerCase());
    if (lock) {
      const unlockTime = new Date(Number(lock.args.unlockTime) * 1000);
      return { status: `✅ Locked until <b>${unlockTime.toUTCString()}</b>`, burnPercent: 0 };
    }
  } catch (err) {
    console.log("Locker query failed:", err);
  }

  return { status: "⚠️ LP Not Locked or Burned", burnPercent: 0 };
}

function formatReport({ name, symbol, totalSupply, owner, buyTax, sellTax, lpInfo, lpBurnPercent, holders, devSells }) {
  // Determine risk rating
  let riskLevel = "🟢 SAFE";
  if (lpInfo.includes("⚠️") || (holders[0]?.percent ?? 0) > 50 || devSells.length > 0) {
    riskLevel = "🔴 DANGER";
  } else if (lpBurnPercent < 50 && lpBurnPercent > 0) {
    riskLevel = "🟡 CAUTION";
  }

  const topHolders =
    holders.length > 0
      ? holders.map((h) => `• <code>${h.address}</code> (${h.percent.toFixed(2)}%)`).join("\n")
      : "N/A";

  const devSellNote =
    devSells.length > 0
      ? `🚨 <b>Dev selling detected in last 24h</b>`
      : "✅ No dev sells in last 24h";

  return `
<b>${riskLevel}</b>

<b>${name ?? "Unknown Token"} (${symbol ?? "?"})</b>

<b>Supply:</b> ${totalSupply ? Number(totalSupply) / 1e18 : "N/A"}
<b>Owner:</b> ${owner ?? "N/A"}
<b>Taxes:</b> Buy ${buyTax ?? "?"}% / Sell ${sellTax ?? "?"}%

<b>LP:</b> ${lpInfo}

<b>Top Holders:</b>
${topHolders}

${devSellNote}
`;
}
