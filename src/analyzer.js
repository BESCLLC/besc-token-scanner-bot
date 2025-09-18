import { ethers } from "ethers";
import erc20Abi from "./abi/ERC20.json" assert { type: "json" };
import lpAbi from "./abi/LP.json" assert { type: "json" };
import lockerAbi from "./abi/Locker.json" assert { type: "json" };
import { tryRead } from "./utils.js";
import { getTopHolders, detectDevSells } from "./holders.js";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

export async function analyzeToken(tokenAddress) {
  tokenAddress = ethers.getAddress(tokenAddress);
  const token = new ethers.Contract(tokenAddress, erc20Abi, provider);

  const [name, symbol, totalSupply, owner] = await Promise.all([
    tryRead(() => token.name()),
    tryRead(() => token.symbol()),
    tryRead(() => token.totalSupply()),
    tryRead(() => token.owner())
  ]);

  const buyTax = await tryRead(() => token.buyTax?.());
  const sellTax = await tryRead(() => token.sellTax?.());

  let lpInfo = "❌ LP Not Found";
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
      if (token0.toLowerCase() === tokenAddress.toLowerCase() || token1.toLowerCase() === tokenAddress.toLowerCase()) {
        lpAddress = pair;
        break;
      }
    }
  } catch (e) {
    console.log("LP scan failed:", e);
  }

  if (lpAddress) {
    lpInfo = await analyzeLP(lpAddress);
  }

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
    holders,
    devSells
  });
}

async function analyzeLP(lpAddress) {
  const locker = new ethers.Contract(process.env.LOCKER_ADDRESS, lockerAbi, provider);
  const events = await locker.queryFilter("Locked", 0, "latest");
  const lock = events.find(e => e.args.token.toLowerCase() === lpAddress.toLowerCase());

  if (lock) {
    const unlockTime = new Date(Number(lock.args.unlockTime) * 1000);
    return `✅ Locked until <b>${unlockTime.toUTCString()}</b>`;
  }

  const lp = new ethers.Contract(lpAddress, lpAbi, provider);
  const dead = "0x000000000000000000000000000000000000dEaD";
  const burned = await lp.balanceOf(dead);

  if (burned > 0n) return "🔥 LP Burned";
  return "⚠️ LP Not Locked or Burned";
}

function formatReport({ name, symbol, totalSupply, owner, buyTax, sellTax, lpInfo, holders, devSells }) {
  const topHolders = holders.map(h => `• ${h.address} (${h.percent.toFixed(2)}%)`).join("\n");
  const devSellNote = devSells.length > 0 ? `🚨 <b>Dev selling detected in last 24h</b>` : "✅ No dev sells in last 24h";

  return `
<b>${name ?? "Unknown Token"} (${symbol ?? "?"})</b>

<b>Supply:</b> ${totalSupply ? Number(totalSupply) / 1e18 : "N/A"}
<b>Owner:</b> ${owner ?? "N/A"}
<b>Taxes:</b> Buy ${buyTax ?? "?"}% / Sell ${sellTax ?? "?"}%

<b>LP:</b> ${lpInfo}

<b>Top Holders:</b>
${topHolders || "N/A"}

${devSellNote}
`;
}
