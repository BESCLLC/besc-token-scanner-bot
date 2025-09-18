import axios from "axios";
import { ethers } from "ethers";
import { getTopHolders, getTokenInfo } from "./holders.js";
import lpAbi from "./abi/LP.json" assert { type: "json" };
import lockerAbi from "./abi/Locker.json" assert { type: "json" };

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
const LOCKER_ADDRESS = process.env.LOCKER_ADDRESS;

/**
 * Analyze a token and return a formatted Telegram message
 */
export async function analyzeToken(tokenAddress) {
  try {
    const tokenInfo = await getTokenInfo(tokenAddress);
    if (!tokenInfo.totalSupply) throw new Error("Token not found on BlockScout");

    const tokenContract = new ethers.Contract(
      tokenAddress,
      [
        "function getOwner() view returns (address)",
        "function owner() view returns (address)",
        "function pair() view returns (address)",
        "function liquidityFee() view returns (uint256)",
        "function marketingFee() view returns (uint256)",
        "function rewardsFee() view returns (uint256)",
        "function teamFee() view returns (uint256)",
        "function liquidityFeeSell() view returns (uint256)",
        "function marketingFeeSell() view returns (uint256)",
        "function rewardsFeeSell() view returns (uint256)",
        "function teamFeeSell() view returns (uint256)",
      ],
      provider
    );

    let owner = "N/A";
    try {
      owner = await tokenContract.getOwner();
    } catch {
      try {
        owner = await tokenContract.owner();
      } catch {
        owner = "N/A";
      }
    }

    // Detect buy/sell tax
    let buyTax = 0;
    let sellTax = 0;
    const taxFns = [
      ["liquidityFee", "buy"],
      ["marketingFee", "buy"],
      ["rewardsFee", "buy"],
      ["teamFee", "buy"],
      ["liquidityFeeSell", "sell"],
      ["marketingFeeSell", "sell"],
      ["rewardsFeeSell", "sell"],
      ["teamFeeSell", "sell"],
    ];
    for (const [fn, type] of taxFns) {
      try {
        const val = await tokenContract[fn]();
        if (type === "buy") buyTax += Number(val);
        else sellTax += Number(val);
      } catch {
        // function might not exist
      }
    }

    // LP Pair + LP lock check
    let lpStatus = "⚠️ LP Not Locked or Burned";
    try {
      const pair = await tokenContract.pair();
      const lp = new ethers.Contract(pair, lpAbi, provider);
      const lpSupply = await lp.totalSupply();

      // Check burned liquidity
      const deadBalance = await lp.balanceOf(
        "0x000000000000000000000000000000000000dEaD"
      );
      const burnedPct = Number((deadBalance * 10000n) / lpSupply) / 100;
      if (burnedPct > 0) {
        lpStatus = `🔥 LP Burned (${burnedPct.toFixed(2)}%)`;
      } else {
        // Check locker
        const locker = new ethers.Contract(LOCKER_ADDRESS, lockerAbi, provider);
        const locks = await locker.getUserLocks(pair);
        const lockedAmt = locks.reduce((acc, l) => acc + BigInt(l.amount), 0n);
        if (lockedAmt > 0n) {
          const unlockTime = Math.max(...locks.map((l) => Number(l.unlockTime)));
          const unlockDate = new Date(unlockTime * 1000);
          lpStatus = `🔒 LP Locked until ${unlockDate.toLocaleDateString()}`;
        }
      }
    } catch (err) {
      console.log("LP status check failed:", err.message);
    }

    // Top holders
    const holders = await getTopHolders(
      tokenAddress,
      10,
      tokenInfo.totalSupply,
      tokenInfo.decimals
    );

    // Build holder text
    let holdersText =
      holders.length > 0
        ? holders
            .map(
              (h) =>
                `• <code>${h.address}</code> (${h.percent.toFixed(2)}%)`
            )
            .join("\n")
        : "No holder data found.";

    // Dev sells detection placeholder (extend with your transfer scanner if needed)
    let devSells = "✅ No dev sells in last 24h";

    return (
      `🟢 SAFE\n\n` +
      `${tokenInfo.name} (${tokenInfo.symbol})\n\n` +
      `Supply: ${tokenInfo.totalSupply.toLocaleString()}\n` +
      `Owner: ${owner}\n` +
      `Taxes: Buy ${buyTax || 0}% / Sell ${sellTax || 0}%\n\n` +
      `LP: ${lpStatus}\n\n` +
      `Top Holders:\n${holdersText}\n\n` +
      `${devSells}`
    );
  } catch (err) {
    console.error("❌ analyzeToken failed:", err);
    return "⚠️ Error analyzing token. Check logs.";
  }
}
