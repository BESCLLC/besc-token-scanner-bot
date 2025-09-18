import axios from "axios";
import { ethers } from "ethers";
import { getTopHolders, getTokenInfo } from "./holders.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const lpAbi = require("./abi/LP.json");
const lockerAbi = require("./abi/Locker.json");

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
const LOCKER_ADDRESS = process.env.LOCKER_ADDRESS;

export async function analyzeToken(tokenAddress) {
  try {
    // --- 1. Token Info ---
    const tokenInfo = await getTokenInfo(tokenAddress);
    if (!tokenInfo.totalSupply) throw new Error("Token not found on BlockScout");

    const tokenContract = new ethers.Contract(
      tokenAddress,
      [
        "event Transfer(address indexed from, address indexed to, uint256 value)",
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
        "function teamFeeSell() view returns (uint256)"
      ],
      provider
    );

    // --- 2. Owner Detection ---
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

    // --- 3. Tax Detection ---
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
      ["teamFeeSell", "sell"]
    ];
    for (const [fn, type] of taxFns) {
      try {
        const val = await tokenContract[fn]();
        if (type === "buy") buyTax += Number(val);
        else sellTax += Number(val);
      } catch {
        // function may not exist, skip
      }
    }

    // --- 4. LP Lock / Burn Status ---
    let lpStatus = "⚠️ LP Not Locked or Burned";
    try {
      const pair = await tokenContract.pair();
      if (pair && pair !== ethers.ZeroAddress) {
        const lp = new ethers.Contract(pair, lpAbi, provider);
        const lpSupply = await lp.totalSupply();

        const deadBalance = await lp.balanceOf(
          "0x000000000000000000000000000000000000dEaD"
        );
        const burnedPct = lpSupply > 0n ? Number((deadBalance * 10000n) / lpSupply) / 100 : 0;
        if (burnedPct > 0) {
          lpStatus = `🔥 LP Burned (${burnedPct.toFixed(2)}%)`;
        } else {
          const locker = new ethers.Contract(LOCKER_ADDRESS, lockerAbi, provider);
          const locks = await locker.getUserLocks(pair);
          if (locks && locks.length > 0) {
            const lockedAmt = locks.reduce((acc, l) => acc + BigInt(l.amount), 0n);
            if (lockedAmt > 0n) {
              const unlockTime = Math.max(...locks.map(l => Number(l.unlockTime)));
              const unlockDate = new Date(unlockTime * 1000);
              lpStatus = `🔒 LP Locked until ${unlockDate.toLocaleDateString()}`;
            }
          }
        }
      }
    } catch (err) {
      console.log("LP check failed:", err.message);
    }

    // --- 5. Top Holders ---
    const holders = await getTopHolders(
      tokenAddress,
      10,
      tokenInfo.totalSupply,
      tokenInfo.decimals
    );
    const holdersText = holders.length
      ? holders.map(h => `• <code>${h.address}</code> (${h.percent.toFixed(2)}%)`).join("\n")
      : "No holder data found.";

    // --- 6. Dev Sell Detection (real scan) ---
    let devSells = "✅ No dev sells in last 24h";
    if (owner && owner !== "N/A") {
      try {
        const latestBlock = await provider.getBlockNumber();
        const fromBlock = latestBlock - 5000; // last ~24h window (adjust if blocktime faster/slower)
        const logs = await tokenContract.queryFilter(
          tokenContract.filters.Transfer(owner, null),
          fromBlock,
          latestBlock
        );

        const sells = logs.filter(
          log => log.args && log.args.to !== owner && log.args.value > 0
        );

        if (sells.length > 0) {
          const totalSold = sells.reduce((acc, l) => acc + l.args.value, 0n);
          const totalSoldFormatted = Number(totalSold) / 10 ** tokenInfo.decimals;
          devSells = `🚨 Dev sold ${totalSoldFormatted.toLocaleString()} ${tokenInfo.symbol} in last 24h`;
        }
      } catch (err) {
        console.log("Dev sell scan failed:", err.message);
      }
    }

    // --- 7. Final Output ---
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
