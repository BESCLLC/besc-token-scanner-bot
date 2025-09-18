import axios from "axios";
import { ethers } from "ethers";
import { getTopHolders, getTokenInfo } from "./holders.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const lpAbi = require("./abi/LP.json");
const lockerAbi = require("./abi/Locker.json");
const routerAbi = require("./abi/Router.json"); // <-- NEW: import router ABI

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS; // <-- Make sure this is set in .env
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
const LOCKER_ADDRESS = process.env.LOCKER_ADDRESS;
const BASE_URL = process.env.BLOCKSCOUT_API || "https://explorer.beschyperchain.com/api/v2";

export async function analyzeToken(tokenAddress) {
  try {
    // --- 1. Get Token Info & Contract Verification ---
    const tokenInfo = await getTokenInfo(tokenAddress);
    const verified = await checkContractVerified(tokenAddress);

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
      } catch {}
    }

    // --- 4. LP Burn/Lock Status ---
    let lpStatus = "⚠️ LP Not Locked or Burned";
    let lpPercentBurned = 0;
    let lpPair = null;
    let pairedToken = null;
    try {
      lpPair = await tokenContract.pair();
      if (lpPair && lpPair !== ethers.ZeroAddress) {
        const lp = new ethers.Contract(lpPair, lpAbi, provider);
        const lpSupply = await lp.totalSupply();

        const deadBalance = await lp.balanceOf("0x000000000000000000000000000000000000dEaD");
        lpPercentBurned = lpSupply > 0n ? Number((deadBalance * 10000n) / lpSupply) / 100 : 0;

        pairedToken = await lp.token0();
        const token1 = await lp.token1();
        if (pairedToken.toLowerCase() === tokenAddress.toLowerCase()) {
          pairedToken = token1;
        }

        if (lpPercentBurned > 0) {
          lpStatus = `🔥 LP Burned (${lpPercentBurned.toFixed(2)}%)`;
        } else {
          const locker = new ethers.Contract(LOCKER_ADDRESS, lockerAbi, provider);
          const locks = await locker.getUserLocks(lpPair);
          if (locks && locks.length > 0) {
            const unlockTime = Math.max(...locks.map((l) => Number(l.unlockTime)));
            const unlockDate = new Date(unlockTime * 1000);
            lpStatus = `🔒 LP Locked until ${unlockDate.toLocaleDateString()}`;
          }
        }
      }
    } catch (err) {
      console.log("LP check failed:", err.message);
    }

    // --- 5. Top Holders (limit to 7 for readability) ---
    const holders = await getTopHolders(tokenAddress, 50, tokenInfo.totalSupply, tokenInfo.decimals);
    const topHoldersDisplay = holders.slice(0, 7);
    let holdersText = topHoldersDisplay.length
      ? topHoldersDisplay.map((h) => `• ${h.label || `<code>${h.address}</code>`} (${h.percent.toFixed(2)}%)`).join("\n")
      : "No holder data found.";
    if (holders.length > 0) {
      const top10Percent = holders.slice(0, 10).reduce((sum, h) => sum + h.percent, 0);
      holdersText += `\n\n<b>Top 10 Holders Own:</b> ${top10Percent.toFixed(2)}% of Supply`;
    }

    // --- 6. Dev Sell Detection ---
    let devSells = "✅ No dev sells in last 24h";
    if (owner && owner !== "N/A") {
      try {
        const latestBlock = await provider.getBlockNumber();
        const fromBlock = latestBlock - 5000;
        const logs = await tokenContract.queryFilter(
          tokenContract.filters.Transfer(owner, null),
          fromBlock,
          latestBlock
        );
        const sells = logs.filter((log) => log.args && log.args.value > 0);
        if (sells.length > 0) {
          devSells = `🚨 Dev made ${sells.length} sells in last 24h`;
        }
      } catch (err) {
        console.log("Dev sell scan failed:", err.message);
      }
    }

    // --- 7. Honeypot Simulation with Router Fallback ---
let honeypotRisk = "✅ Sell simulation succeeded";
try {
  const testWallet = ethers.Wallet.createRandom().address;
  await provider.call({
    to: tokenAddress,
    data: tokenContract.interface.encodeFunctionData("transfer", [testWallet, 1n])
  });
} catch (transferErr) {
  console.log("Direct transfer failed, trying Router swap simulation with allowance...");
  try {
    if (ROUTER_ADDRESS && pairedToken) {
      const router = new ethers.Contract(ROUTER_ADDRESS, routerAbi, provider);
      const path = [tokenAddress, pairedToken];
      const deadline = Math.floor(Date.now() / 1000) + 60;

      // 1️⃣ Approve simulation
      const approveData = tokenContract.interface.encodeFunctionData("approve", [
        ROUTER_ADDRESS,
        ethers.MaxUint256
      ]);
      await provider.call({ to: tokenAddress, data: approveData });

      // 2️⃣ Swap simulation
      const data = router.interface.encodeFunctionData(
        "swapExactTokensForTokensSupportingFeeOnTransferTokens",
        [ethers.parseUnits("1", tokenInfo.decimals), 0, path, testWallet, deadline]
      );
      await provider.call({ to: ROUTER_ADDRESS, data });

      honeypotRisk = "✅ Router swap simulation passed (sell possible)";
    } else {
      honeypotRisk = "⚠️ No router/pair found — cannot simulate sell.";
    }
  } catch (dexErr) {
    console.error("Router simulation error:", dexErr.message);
    honeypotRisk = "🛑 Possible Honeypot — Router swap still reverted!";
  }
}

    // --- 8. Risk Assessment ---
    const risk = calculateRisk({ buyTax, sellTax, lpPercentBurned, holders });

    // --- 9. Final Output ---
    return [
      `${risk.emoji} <b>${risk.label}</b>`,
      `\n<b>🔎 Token Overview</b>`,
      `${tokenInfo.name} (${tokenInfo.symbol})`,
      `Supply: ${tokenInfo.totalSupply.toLocaleString()}`,
      `Owner: ${owner}`,
      `Contract: ${verified ? "✅ Verified" : "⚠️ Unverified"}`,
      `Taxes: Buy ${buyTax || 0}% / Sell ${sellTax || 0}%`,

      `\n<b>💧 Liquidity</b>`,
      lpStatus,

      `\n<b>👥 Top Holders</b>`,
      holdersText,

      `\n<b>🛑 Risk Factors</b>`,
      `• Holder Concentration: ${risk.holderComment}`,
      `• Tax Risk: ${risk.taxComment}`,
      `• LP Risk: ${risk.lpComment}`,
      `• Honeypot Check: ${honeypotRisk}`,

      `\n<b>📊 Trader Insights</b>`,
      `${risk.traderInsights}`,

      `\n${devSells}`
    ].join("\n");
  } catch (err) {
    console.error("❌ analyzeToken failed:", err);
    return "⚠️ Error analyzing token. Check logs.";
  }
}

function calculateRisk({ buyTax, sellTax, lpPercentBurned, holders }) {
  let score = 0;
  let holderComment = "Healthy";
  let taxComment = "Reasonable";
  let lpComment = "Sufficiently burned/locked";
  let traderInsights = "Token looks safe for trading.";

  if (buyTax > 10 || sellTax > 10) {
    score += 2;
    taxComment = "⚠️ High tax - possible honeypot.";
  }
  if (lpPercentBurned < 50) {
    score += 2;
    lpComment = "⚠️ Low burn/lock - liquidity can be removed.";
  }
  if (holders.length > 0 && holders[0].percent > 30) {
    score += 2;
    holderComment = "⚠️ Whale holds >30% supply.";
  }

  if (score >= 4) traderInsights = "High rug risk — trade cautiously.";
  else if (score >= 2) traderInsights = "Moderate risk — DYOR before buying.";

  return {
    emoji: score >= 4 ? "🔴" : score >= 2 ? "🟡" : "🟢",
    label: score >= 4 ? "HIGH RISK" : score >= 2 ? "MEDIUM RISK" : "SAFE",
    holderComment,
    taxComment,
    lpComment,
    traderInsights
  };
}

async function checkContractVerified(address) {
  try {
    const res = await axios.get(`${BASE_URL}/smart-contracts/${address}`);
    return res.data && res.data.compiler_version ? true : false;
  } catch {
    return false;
  }
}
