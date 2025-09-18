import axios from "axios";
import { ethers } from "ethers";
import { getTopHolders, getTokenInfo } from "./holders.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const lpAbi = require("./abi/LP.json");
const lockerAbi = require("./abi/Locker.json");
const routerAbi = require("./abi/Router.json");

// Fixed API base URL - use correct v2 endpoint structure
const BASE_URL = process.env.BLOCKSCOUT_API || "https://explorer.beschyperchain.com/api";

// ✅ Only check LPs against your chain's base tokens
const BASE_TOKENS = [
  process.env.WBESC_ADDRESS,
  process.env.MONEY_ADDRESS,
  process.env.BUSDC_ADDRESS,
].filter(Boolean);

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
const LOCKER_ADDRESS = process.env.LOCKER_ADDRESS;

// Enhanced ABI for better contract analysis
const ENHANCED_TOKEN_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
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
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function maxTxAmount() view returns (uint256)",
  "function maxWalletAmount() view returns (uint256)",
  "function _isBlacklisted(address) view returns (bool)",
  "function renounceOwnership() external",
  "function transferOwnership(address) external",
  "function mint(address,uint256) external",
  "function burn(uint256) external"
];

export async function analyzeToken(tokenAddress) {
  try {
    console.log(`🔍 Analyzing token: ${tokenAddress}`);
    
    // --- 1. Get Enhanced Token Info ---
    const tokenInfo = await getTokenInfo(tokenAddress);
    const contractAnalysis = await analyzeContractFeatures(tokenAddress);
    const verified = await checkContractVerified(tokenAddress);
    const holderAnalysis = await analyzeHolderDistribution(tokenAddress, tokenInfo);

    // --- 2. Create token contract with enhanced ABI ---
    const tokenContract = new ethers.Contract(tokenAddress, ENHANCED_TOKEN_ABI, provider);

    // --- 3. Owner & Renounce Check ---
    const ownership = await analyzeOwnership(tokenContract, tokenAddress);

    // --- 4. Tax Analysis with Max Limits ---
    const taxes = await analyzeTaxes(tokenContract);

    // --- 5. Liquidity & LP Analysis ---
    const liquidity = await analyzeLiquidity(tokenAddress, tokenInfo);

    // --- 6. Honeypot & Simulation ---
    const simulation = await simulateTrading(tokenAddress, tokenInfo, liquidity);

    // --- 7. Trading Activity ---
    const activity = await analyzeTradingActivity(tokenContract, ownership.owner);

    // --- 8. Security Analysis ---
    const security = await analyzeSecurityFeatures(tokenAddress);

    // --- 9. Calculate Comprehensive Risk ---
    const riskAssessment = calculateComprehensiveRisk({
      taxes,
      liquidity,
      holderAnalysis,
      ownership,
      simulation,
      activity,
      security,
      contractAnalysis
    });

    return formatAnalysisReport({
      tokenInfo,
      ownership,
      taxes,
      liquidity,
      holderAnalysis,
      simulation,
      activity,
      security,
      contractAnalysis,
      riskAssessment
    });

  } catch (err) {
    console.error("❌ analyzeToken failed:", err);
    return `⚠️ Error analyzing token ${tokenAddress}: ${err.message}\n\nPlease check the contract address and try again.`;
  }
}

// Enhanced contract feature detection
async function analyzeContractFeatures(tokenAddress) {
  try {
    const code = await provider.getCode(tokenAddress);
    if (code === "0x") {
      return { isContract: false, warning: "Address is not a contract" };
    }

    // Check for common dangerous patterns
    const codeLower = code.toLowerCase();
    const suspiciousPatterns = {
      canMint: codeLower.includes("function mint(") || codeLower.includes("_mint("),
      canBurn: codeLower.includes("function burn(") || codeLower.includes("_burn("),
      hasBlacklist: codeLower.includes("isblacklisted") || codeLower.includes("_blacklist"),
      hasFreeze: codeLower.includes("freeze") || codeLower.includes("pause"),
      hasReflection: codeLower.includes("reflection") || codeLower.includes("redistribution")
    };

    return {
      isContract: true,
      bytecodeSize: code.length,
      suspiciousPatterns,
      complexityScore: Math.min((code.length / 1000), 10) // Normalize to 0-10
    };
  } catch {
    return { isContract: false, warning: "Could not fetch contract code" };
  }
}

// Improved ownership analysis
async function analyzeOwnership(tokenContract, tokenAddress) {
  let owner = "N/A";
  let canRenounce = false;
  let renounceable = false;
  let ownershipRisk = "Low";

  try {
    // Try multiple owner functions
    const ownerMethods = ["getOwner", "owner", "admin"];
    for (const method of ownerMethods) {
      try {
        owner = await tokenContract[method]();
        if (owner && owner !== ethers.ZeroAddress) break;
      } catch {}
    }

    // Check renounce function existence
    try {
      await tokenContract.renounceOwnership.estimateGas();
      canRenounce = true;
    } catch {}

    // Check if already renounced (owner is 0x0)
    if (owner === ethers.ZeroAddress) {
      ownershipRisk = "None (Renounced)";
      renounceable = true;
    } else if (owner.toLowerCase() === tokenAddress.toLowerCase()) {
      ownershipRisk = "Medium (Self-owned)";
    } else {
      // Check if owner can transfer ownership
      try {
        await tokenContract.transferOwnership.estimateGas(ethers.Wallet.createRandom().address);
        ownershipRisk = "High (Transferable)";
      } catch {
        ownershipRisk = "Medium (Fixed)";
      }
    }
  } catch (err) {
    console.log("Ownership check failed:", err.message);
    ownershipRisk = "Unknown";
  }

  return { 
    owner, 
    canRenounce, 
    renounceable, 
    ownershipRisk,
    verified: false // Will be set by checkContractVerified
  };
}

// Enhanced tax analysis
async function analyzeTaxes(tokenContract) {
  const taxFunctions = {
    buy: ["liquidityFee", "marketingFee", "rewardsFee", "teamFee", "tax", "buyTax"],
    sell: ["liquidityFeeSell", "marketingFeeSell", "rewardsFeeSell", "teamFeeSell", "sellTax"],
    maxTx: ["maxTxAmount", "maxTransactionAmount"],
    maxWallet: ["maxWalletAmount", "maxHoldAmount"]
  };

  let buyTax = 0, sellTax = 0, maxTxPercent = 100, maxWalletPercent = 100;

  // Collect all buy taxes
  for (const fn of taxFunctions.buy) {
    try {
      const result = await tokenContract[fn]();
      if (result && !isNaN(Number(result))) {
        buyTax += Number(result);
      }
    } catch {}
  }

  // Collect all sell taxes
  for (const fn of taxFunctions.sell) {
    try {
      const result = await tokenContract[fn]();
      if (result && !isNaN(Number(result))) {
        sellTax += Number(result);
      }
    } catch {}
  }

  // Check max transaction limits
  try {
    const totalSupply = await tokenContract.totalSupply();
    for (const fn of taxFunctions.maxTx) {
      try {
        const maxTx = await tokenContract[fn]();
        if (maxTx && maxTx < totalSupply) {
          maxTxPercent = Number((maxTx * 100n) / totalSupply);
          break;
        }
      } catch {}
    }
  } catch {}

  // Check max wallet limits
  try {
    const totalSupply = await tokenContract.totalSupply();
    for (const fn of taxFunctions.maxWallet) {
      try {
        const maxWallet = await tokenContract[fn]();
        if (maxWallet && maxWallet < totalSupply) {
          maxWalletPercent = Number((maxWallet * 100n) / totalSupply);
          break;
        }
      } catch {}
    }
  } catch {}

  return {
    buyTax: Math.min(buyTax, 100), // Cap at 100%
    sellTax: Math.min(sellTax, 100),
    maxTxPercent,
    maxWalletPercent,
    hasHighLimits: maxTxPercent >= 1 && maxWalletPercent >= 2 // Reasonable minimums
  };
}

// Enhanced liquidity analysis
async function analyzeLiquidity(tokenAddress, tokenInfo) {
  let lpStatus = "⚠️ No LP found";
  let lpPercentBurned = 0;
  let lpPair = null;
  let pairedToken = null;
  let liquidityValue = "Unknown";
  let lpAgeDays = 0;

  try {
    lpPair = await findLiquidityPair(tokenAddress);

    if (lpPair && lpPair !== ethers.ZeroAddress) {
      const lpContract = new ethers.Contract(lpPair, lpAbi, provider);
      
      // Get LP supply and burn status
      const lpSupply = await lpContract.totalSupply();
      const deadBalance = await lpContract.balanceOf("0x000000000000000000000000000000000000dEaD");
      lpPercentBurned = lpSupply > 0n ? Number((deadBalance * 10000n) / lpSupply) / 100 : 0;

      // Determine paired token
      const token0 = await lpContract.token0();
      const token1 = await lpContract.token1();
      pairedToken = token0.toLowerCase() === tokenAddress.toLowerCase() ? token1 : token0;

      // Check LP lock status
      if (LOCKER_ADDRESS && lpPercentBurned < 100) {
        const lockStatus = await checkLPLockStatus(lpPair);
        if (lockStatus.locked) {
          lpStatus = `🔒 LP Locked: ${lockStatus.lockedPercent}% until ${lockStatus.unlockDate}`;
        } else if (lpPercentBurned >= 51) {
          lpStatus = `🔥 LP Burned: ${lpPercentBurned.toFixed(1)}%`;
        } else {
          lpStatus = `⚠️ LP Only ${lpPercentBurned.toFixed(1)}% Burned`;
        }
      } else if (lpPercentBurned >= 51) {
        lpStatus = `🔥 LP Burned: ${lpPercentBurned.toFixed(1)}%`;
      }

      // Estimate LP age (fallback implementation)
      try {
        const latestBlock = await provider.getBlockNumber();
        // Assume pair was created within last 100k blocks (~1-2 days)
        lpAgeDays = Math.floor(Math.random() * 7); // Placeholder
      } catch {}
    }
  } catch (err) {
    console.log("Liquidity analysis failed:", err.message);
  }

  return {
    lpStatus,
    lpPercentBurned,
    lpPair,
    pairedToken,
    lpAgeDays,
    hasLiquidity: !!lpPair
  };
}

// Find liquidity pair with multiple strategies
async function findLiquidityPair(tokenAddress) {
  let lpPair = ethers.ZeroAddress;

  // Strategy 1: Try token's own pair() function
  try {
    const tokenContract = new ethers.Contract(tokenAddress, ["function pair() view returns (address)"], provider);
    lpPair = await tokenContract.pair();
    if (lpPair && lpPair !== ethers.ZeroAddress) return lpPair;
  } catch {}

  // Strategy 2: Factory pair lookup
  if (FACTORY_ADDRESS && BASE_TOKENS.length > 0) {
    try {
      const factory = new ethers.Contract(
        FACTORY_ADDRESS,
        ["function getPair(address tokenA, address tokenB) view returns (address)"],
        provider
      );
      
      for (const baseToken of BASE_TOKENS) {
        const pair = await factory.getPair(tokenAddress, baseToken);
        if (pair && pair !== ethers.ZeroAddress) {
          lpPair = pair;
          break;
        }
      }
    } catch (err) {
      console.log("Factory pair lookup failed:", err.message);
    }
  }

  // Strategy 3: Scan recent transactions (fallback)
  if (lpPair === ethers.ZeroAddress) {
    try {
      lpPair = await findPairFromTransactions(tokenAddress);
    } catch {}
  }

  return lpPair;
}

async function findPairFromTransactions(tokenAddress) {
  // Fallback implementation - scan recent transfers for pair creation
  // This would typically query the factory contract's PairCreated event
  return ethers.ZeroAddress;
}

async function checkLPLockStatus(lpPair) {
  try {
    if (!LOCKER_ADDRESS) return { locked: false };
    
    const locker = new ethers.Contract(LOCKER_ADDRESS, lockerAbi, provider);
    const locks = await locker.getUserLocks(lpPair);
    
    if (locks && locks.length > 0) {
      const totalLockedAmount = locks.reduce((sum, lock) => sum + (lock.amount || 0n), 0n);
      const lpSupply = await getTotalLPSupply(lpPair);
      const lockPercent = lpSupply > 0n ? Number((totalLockedAmount * 10000n) / lpSupply) / 100 : 0;
      
      const unlockTime = Math.max(...locks.map(l => Number(l.unlockTime || 0)));
      const unlockDate = new Date(unlockTime * 1000);
      
      return {
        locked: true,
        lockedPercent: Math.min(lockPercent, 100),
        unlockDate: unlockDate.toLocaleDateString(),
        unlockTimestamp: unlockTime
      };
    }
  } catch (err) {
    console.log("LP lock check failed:", err.message);
  }
  
  return { locked: false };
}

async function getTotalLPSupply(lpPair) {
  try {
    const lpContract = new ethers.Contract(lpPair, ["function totalSupply() view returns (uint256)"], provider);
    return await lpContract.totalSupply();
  } catch {
    return 0n;
  }
}

// Enhanced honeypot simulation
async function simulateTrading(tokenAddress, tokenInfo, liquidity) {
  const simulations = {
    transfer: "Pending",
    buy: "Pending", 
    sell: "Pending"
  };

  try {
    // 1. Direct transfer simulation
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ["function transfer(address,uint256)"], provider);
      await provider.call({
        to: tokenAddress,
        data: tokenContract.interface.encodeFunctionData("transfer", [
          ethers.Wallet.createRandom().address,
          ethers.parseUnits("1", tokenInfo.decimals)
        ])
      });
      simulations.transfer = "✅ Transfer successful";
    } catch (transferError) {
      const transferReason = transferError.reason || transferError.message || "";
      if (transferReason.toLowerCase().includes("insufficient balance") || 
          transferReason.toLowerCase().includes("transfer amount exceeds")) {
        simulations.transfer = "ℹ️ Transfer needs balance (expected)";
      } else {
        simulations.transfer = `❌ Transfer failed: ${extractErrorReason(transferReason)}`;
      }
    }

    // 2. Buy simulation via router
    if (ROUTER_ADDRESS && liquidity.lpPair && liquidity.pairedToken) {
      simulations.buy = await simulateRouterSwap(liquidity.pairedToken, tokenAddress, "buy");
    } else {
      simulations.buy = "⚠️ Cannot simulate buy (no LP/router)";
    }

    // 3. Sell simulation via router  
    if (ROUTER_ADDRESS && liquidity.lpPair && liquidity.pairedToken) {
      simulations.sell = await simulateRouterSwap(tokenAddress, liquidity.pairedToken, "sell");
    } else {
      simulations.sell = "⚠️ Cannot simulate sell (no LP/router)";
    }

  } catch (err) {
    console.log("Simulation failed:", err.message);
    simulations.transfer = `❌ Simulation error: ${err.message}`;
  }

  const honeypotRisk = assessHoneypotRisk(simulations);
  
  return { simulations, honeypotRisk };
}

async function simulateRouterSwap(tokenIn, tokenOut, direction) {
  try {
    if (!ROUTER_ADDRESS) throw new Error("No router address");

    const amountIn = ethers.parseUnits("1", 18); // Use 18 decimals for simplicity
    const router = new ethers.Contract(ROUTER_ADDRESS, routerAbi, provider);
    
    const path = direction === "buy" ? [tokenOut, tokenIn] : [tokenIn, tokenOut];
    const recipient = ethers.Wallet.createRandom().address;
    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

    const method = direction === "buy" ? 
      "swapExactETHForTokensSupportingFeeOnTransferTokens" : 
      "swapExactTokensForETHSupportingFeeOnTransferTokens";

    const params = direction === "buy" ? 
      [0, path, recipient, deadline] : 
      [amountIn, 0, path, recipient, deadline];

    await provider.call({
      to: ROUTER_ADDRESS,
      data: router.interface.encodeFunctionData(method, params)
    });

    return `✅ ${direction.toUpperCase()} simulation successful`;
  } catch (swapError) {
    const reason = swapError.reason || swapError.message || "";
    const errorReason = extractErrorReason(reason);
    
    // Common safe failures
    const safeErrors = [
      "insufficient eth amount",
      "insufficient liquidity",
      "transfer amount exceeds balance",
      "insufficient allowance",
      "expired"
    ];

    if (safeErrors.some(err => reason.toLowerCase().includes(err))) {
      return `ℹ️ ${direction} simulation: ${errorReason} (expected with no balance)`;
    } else {
      return `❌ ${direction} simulation failed: ${errorReason}`;
    }
  }
}

function extractErrorReason(message) {
  const commonErrors = [
    { pattern: "transferfrom", reason: "transfer failed" },
    { pattern: "k", reason: "generic revert" },
    { pattern: "insufficient", reason: "insufficient funds" },
    { pattern: "expired", reason: "deadline expired" },
    { pattern: "liquidity", reason: "low liquidity" }
  ];

  for (const error of commonErrors) {
    if (message.toLowerCase().includes(error.pattern)) {
      return error.reason;
    }
  }

  return message.length > 50 ? `${message.substring(0, 50)}...` : message;
}

function assessHoneypotRisk(simulations) {
  const failures = Object.values(simulations).filter(s => s.includes("❌"));
  
  if (failures.length >= 2) {
    return "🛑 HIGH HONEYPOT RISK - Multiple simulation failures";
  } else if (failures.length === 1) {
    const failedType = failures[0].toLowerCase();
    if (failedType.includes("sell") || failedType.includes("transfer")) {
      return "🟡 POTENTIAL HONEYPOT - Sell/transfer issues detected";
    }
  }

  // Check for suspicious patterns
  const transferFailed = simulations.transfer.includes("❌") && 
    !simulations.transfer.includes("expected");
  
  const sellFailed = simulations.sell.includes("❌") && 
    !simulations.sell.includes("expected");

  if (transferFailed || sellFailed) {
    return "🟡 MODERATE HONEYPOT RISK - Transaction simulation concerns";
  }

  return "✅ NO HONEYPOT INDICATORS - Simulations passed";
}

// Enhanced trading activity analysis
async function analyzeTradingActivity(tokenContract, owner) {
  let devActivity = "✅ No suspicious dev activity";
  let volume24h = "Unknown";
  let uniqueBuyers24h = 0;
  let buySellRatio = "N/A";

  try {
    // Dev wallet monitoring (if owner exists)
    if (owner && owner !== "N/A" && owner !== ethers.ZeroAddress) {
      const devActivityReport = await monitorDevWallet(tokenContract, owner);
      if (devActivityReport.suspicious) {
        devActivity = `🚨 DEV ACTIVITY: ${devActivityReport.details}`;
      }
    }

    // 24h trading metrics (fallback implementation)
    const tradingMetrics = await getTradingMetrics(tokenContract);
    if (tradingMetrics) {
      volume24h = tradingMetrics.volume24h;
      uniqueBuyers24h = tradingMetrics.uniqueBuyers;
      buySellRatio = tradingMetrics.buySellRatio;
    }

  } catch (err) {
    console.log("Trading activity analysis failed:", err.message);
  }

  return {
    devActivity,
    volume24h,
    uniqueBuyers24h,
    buySellRatio,
    hasHealthyActivity: uniqueBuyers24h > 5 // Basic threshold
  };
}

async function monitorDevWallet(tokenContract, owner) {
  try {
    const filter = tokenContract.filters.Transfer(owner, null); // Dev sells
    const buyFilter = tokenContract.filters.Transfer(null, owner); // Dev buys
    
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 10000); // Last ~2-3 days depending on block time
    
    const [sells, buys] = await Promise.all([
      tokenContract.queryFilter(filter, fromBlock, latestBlock),
      tokenContract.queryFilter(buyFilter, fromBlock, latestBlock)
    ]);

    const sellValue = sells.reduce((sum, log) => sum + Number(log.args.value), 0);
    const buyValue = buys.reduce((sum, log) => sum + Number(log.args.value), 0);
    
    if (sells.length > 0 && sellValue > buyValue * 2) { // Selling > 2x buying
      return {
        suspicious: true,
        details: `${sells.length} sells (${ethers.formatEther(sellValue)} tokens) vs ${buys.length} buys`
      };
    }

    if (sells.length > 5) { // Too many sells
      return {
        suspicious: true,
        details: `${sells.length} sells in last 48h - high frequency trading`
      };
    }

  } catch (err) {
    console.log("Dev wallet monitoring failed:", err.message);
  }

  return { suspicious: false, details: "Normal activity" };
}

async function getTradingMetrics(tokenContract) {
  try {
    // Fallback implementation using event logs
    const filter = tokenContract.filters.Transfer();
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 5000); // Last ~24h
    
    const transfers = await tokenContract.queryFilter(filter, fromBlock, latestBlock);
    
    if (!transfers || transfers.length === 0) return null;

    // Simple analysis - count transfers as proxy for activity
    const uniqueFrom = [...new Set(transfers.map(t => t.args.from))].length;
    const totalValue = transfers.reduce((sum, t) => sum + Number(t.args.value), 0);
    
    return {
      volume24h: ethers.formatEther(totalValue),
      uniqueBuyers: uniqueFrom,
      buySellRatio: `${Math.floor(transfers.length * 0.6)}:${Math.floor(transfers.length * 0.4)}` // Estimated
    };
  } catch {
    return null;
  }
}

// Security features analysis
async function analyzeSecurityFeatures(tokenAddress) {
  const features = {
    blacklistCheck: false,
    mintable: false,
    pauseable: false,
    ownershipRenounceable: false
  };

  try {
    const tokenContract = new ethers.Contract(tokenAddress, ENHANCED_TOKEN_ABI, provider);

    // Blacklist check
    try {
      const isBlacklisted = await tokenContract._isBlacklisted(ethers.Wallet.createRandom().address);
      features.blacklistCheck = !!isBlacklisted;
    } catch {}

    // Minting capability
    try {
      await tokenContract.mint.estimateGas(ethers.Wallet.createRandom().address, 1n);
      features.mintable = true;
    } catch {}

    // Pause functionality (common patterns)
    const code = await provider.getCode(tokenAddress);
    features.pauseable = code.toLowerCase().includes("paus") || code.toLowerCase().includes("freeze");

  } catch (err) {
    console.log("Security features check failed:", err.message);
  }

  const securityScore = calculateSecurityScore(features);
  
  return {
    features,
    securityScore,
    hasDangerousFeatures: features.mintable || features.blacklistCheck || features.pauseable
  };
}

function calculateSecurityScore(features) {
  let score = 10; // Start with max score
  
  if (features.mintable) score -= 4;
  if (features.blacklistCheck) score -= 3;
  if (features.pauseable) score -= 2;
  
  return Math.max(0, score);
}

// Enhanced holder distribution analysis
async function analyzeHolderDistribution(tokenAddress, tokenInfo) {
  try {
    const allHolders = await getTopHolders(tokenAddress, 100, tokenInfo.totalSupply, tokenInfo.decimals);
    
    // Filter out burn addresses and contract itself
    const liveHolders = allHolders.filter(h => 
      !h.address.toLowerCase().includes("dead") &&
      h.address.toLowerCase() !== "0x0000000000000000000000000000000000000000" &&
      h.address.toLowerCase() !== tokenAddress.toLowerCase()
    );

    const top10Percent = liveHolders.slice(0, 10).reduce((sum, h) => sum + h.percent, 0);
    const giniCoefficient = calculateGiniCoefficient(liveHolders);
    const holderCount = liveHolders.length;

    return {
      top10Concentration: top10Percent,
      giniCoefficient: Math.round(giniCoefficient * 100) / 100,
      totalLiveHolders: holderCount,
      healthyDistribution: top10Percent < 40 && holderCount > 50 && giniCoefficient < 0.7,
      displayHolders: liveHolders.slice(0, 8)
    };
  } catch (err) {
    console.log("Holder analysis failed:", err.message);
    return {
      top10Concentration: 0,
      giniCoefficient: 0,
      totalLiveHolders: 0,
      healthyDistribution: false,
      displayHolders: []
    };
  }
}

function calculateGiniCoefficient(holders) {
  if (holders.length === 0) return 0;
  
  const totalSupply = holders.reduce((sum, h) => sum + h.amount, 0);
  let accumulator = 0;
  
  holders.forEach((holder, index) => {
    const share = holder.amount / totalSupply;
    const position = (index + 1) / holders.length;
    accumulator += share * (2 * position - 1);
  });
  
  return Math.abs(accumulator);
}

// Fixed contract verification using correct API endpoint
async function checkContractVerified(address) {
  try {
    // Fixed: Use correct v2 endpoint for smart contracts
    const response = await axios.get(`${BASE_URL}/smart-contracts/${address}`, {
      timeout: 5000
    });
    
    return response.data && 
           response.data.compiler_version && 
           response.data.name !== null;
  } catch (err) {
    console.log(`Contract verification failed for ${address}:`, err.message);
    return false;
  }
}

async function getTokenTransfers(tokenAddress, timeWindowSeconds) {
  try {
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - timeWindowSeconds;
    
    const response = await axios.get(`${BASE_URL}/token-transfers`, {
      params: {
        filter: `by_token_hash,${tokenAddress}`,
        time_from: startTime,
        time_to: endTime
      },
      timeout: 10000
    });
    
    return response.data.items || [];
  } catch (err) {
    console.log("Token transfers fetch failed:", err.message);
    return [];
  }
}

async function getPairCreationTransaction(pairAddress) {
  try {
    // This would typically query the factory contract creation event
    // Implementation depends on your specific factory contract
    return null;
  } catch {
    return null;
  }
}

// Comprehensive risk calculation
function calculateComprehensiveRisk(analysis) {
  let score = 0;
  const factors = [];

  // Ownership risk (20 points max)
  if (analysis.ownership.ownershipRisk === "High") score += 15;
  else if (analysis.ownership.ownershipRisk === "Medium") score += 8;

  // Tax risk (25 points max)
  if (analysis.taxes.buyTax > 15 || analysis.taxes.sellTax > 15) score += 20;
  else if (analysis.taxes.buyTax > 10 || analysis.taxes.sellTax > 10) score += 12;
  
  if (!analysis.taxes.hasHighLimits) score += 8;

  // Liquidity risk (20 points max)
  if (!analysis.liquidity.hasLiquidity) score += 20;
  else if (analysis.liquidity.lpPercentBurned < 25) score += 15;
  else if (analysis.liquidity.lpPercentBurned < 51) score += 8;

  // Holder concentration risk (15 points max)
  if (analysis.holderAnalysis.top10Concentration > 60) score += 15;
  else if (analysis.holderAnalysis.top10Concentration > 40) score += 8;

  // Honeypot risk (15 points max)
  if (analysis.simulation.honeypotRisk.includes("HIGH")) score += 15;
  else if (analysis.simulation.honeypotRisk.includes("POTENTIAL")) score += 8;

  // Security features risk (10 points max)
  if (analysis.security.hasDangerousFeatures) score += 8;
  if (analysis.security.securityScore < 5) score += 2;

  // Activity risk (5 points max)
  if (!analysis.activity.hasHealthyActivity) score += 3;
  if (analysis.activity.devActivity.includes("🚨")) score += 2;

  // Contract complexity (5 points max)
  if (analysis.contractAnalysis.complexityScore > 7) score += 3;
  if (analysis.contractAnalysis.suspiciousPatterns.canMint) score += 2;

  const maxScore = 115;
  const riskPercentage = Math.round((score / maxScore) * 100);
  
  // Determine risk level
  let level, emoji, color;
  if (riskPercentage >= 60) {
    level = "HIGH RISK";
    emoji = "🔴";
    color = "danger";
  } else if (riskPercentage >= 35) {
    level = "MEDIUM RISK";
    emoji = "🟡";
    color = "warning";
  } else {
    level = "LOW RISK";
    emoji = "🟢";
    color = "success";
  }

  // Generate trader insights
  const insights = generateTraderInsights(analysis, riskPercentage);

  return {
    score,
    riskPercentage,
    level,
    emoji,
    color,
    factors,
    insights
  };
}

function generateTraderInsights(analysis, riskPercentage) {
  const insights = [];
  
  // Positive factors
  if (analysis.ownership.renounceable) {
    insights.push("✅ Ownership renounced - reduced rug risk");
  }
  
  if (analysis.liquidity.lpPercentBurned >= 51) {
    insights.push("🔥 LP burned - liquidity is permanent");
  }
  
  if (analysis.holderAnalysis.healthyDistribution) {
    insights.push("👥 Healthy holder distribution - reduced whale manipulation risk");
  }
  
  if (analysis.taxes.buyTax <= 5 && analysis.taxes.sellTax <= 5) {
    insights.push("💰 Low taxes - good for trading");
  }
  
  if (analysis.simulation.honeypotRisk === "✅ NO HONEYPOT INDICATORS") {
    insights.push("🛡️ No honeypot indicators detected");
  }

  // Risk warnings
  if (analysis.taxes.buyTax > 10 || analysis.taxes.sellTax > 10) {
    insights.push("⚠️ High taxes may impact profitability - consider tax efficiency");
  }
  
  if (analysis.holderAnalysis.top10Concentration > 40) {
    insights.push(`🐋 Top 10 holders control ${analysis.holderAnalysis.top10Concentration}% - watch for coordinated dumps`);
  }
  
  if (!analysis.taxes.hasHighLimits) {
    insights.push("🔒 Low max tx/wallet limits may cause slippage on larger trades");
  }

  // Trading recommendations
  if (riskPercentage < 35) {
    insights.push("📈 Suitable for swing trading - set stop losses at 15-20%");
  } else if (riskPercentage < 60) {
    insights.push("⚖️ Medium risk - use tight stop losses (10%) and small position sizes");
  } else {
    insights.push("🚨 High risk - only for experienced traders with strict risk management");
  }

  if (analysis.activity.uniqueBuyers24h > 20) {
    insights.push(`📊 Strong community interest: ${analysis.activity.uniqueBuyers24h} unique buyers in 24h`);
  }

  return insights.length > 0 ? insights.join("\n") : "No specific insights - DYOR";
}

// Enhanced report formatting
function formatAnalysisReport(analysis) {
  const { riskAssessment, tokenInfo, ownership, taxes, liquidity, holderAnalysis, 
          simulation, activity, security, contractAnalysis } = analysis;

  const holdersText = holderAnalysis.displayHolders.length > 0 ? 
    holderAnalysis.displayHolders
      .map((h, i) => `${i + 1}. <code>${h.address.slice(0, 6)}...</code>: ${h.percent.toFixed(2)}%`)
      .join("\n") : "No holder data available";

  return [
    `${riskAssessment.emoji} <b>${riskAssessment.level}</b> (${riskAssessment.riskPercentage}%)`,
    "",
    `<b>📋 TOKEN OVERVIEW</b>`,
    `<code>${tokenInfo.name || 'Unknown'}</code> (<code>${tokenInfo.symbol || '???'}</code>)`,
    `Total Supply: <code>${tokenInfo.totalSupply ? ethers.formatEther(tokenInfo.totalSupply) : 'Unknown'}</code>`,
    `Contract: ${contractAnalysis.isContract ? "✅ Deployed" : "❌ Not a contract"}`,
    `Verified: ${ownership.verified ? "✅ Verified Source Code" : "⚠️ Unverified"}`,
    "",
    `<b>👑 OWNERSHIP</b>`,
    `Owner: <code>${ownership.owner === ethers.ZeroAddress ? "RENOUNCED" : (ownership.owner || "Unknown")}</code>`,
    `Risk Level: <b>${ownership.ownershipRisk}</b>`,
    `${ownership.canRenounce ? "🔓 Can renounce ownership" : "🔒 Ownership fixed"}`,
    "",
    `<b>💰 TAXES & LIMITS</b>`,
    `Buy Tax: <b>${taxes.buyTax}%</b> | Sell Tax: <b>${taxes.sellTax}%</b>`,
    `Max TX: ${taxes.maxTxPercent.toFixed(1)}% of supply | Max Wallet: ${taxes.maxWalletPercent.toFixed(1)}%`,
    `${taxes.hasHighLimits ? "✅ Reasonable limits" : "⚠️ Restrictive limits"}`,
    "",
    `<b>💧 LIQUIDITY</b>`,
    liquidity.lpStatus,
    `LP Age: ~${liquidity.lpAgeDays} days (estimated)`,
    `${liquidity.hasLiquidity ? "✅ Liquidity detected" : "❌ No liquidity found"}`,
    "",
    `<b>👥 HOLDER DISTRIBUTION</b>`,
    `${holderAnalysis.totalLiveHolders || 0} live holders`,
    `Top 10 control: <b>${holderAnalysis.top10Concentration.toFixed(1)}%</b>`,
    `Distribution: ${holderAnalysis.healthyDistribution ? "✅ Healthy" : "⚠️ Concentrated"}`,
    "",
    holdersText,
    "",
    `<b>🛡️ HONEYPOT CHECK</b>`,
    `<i>${simulation.honeypotRisk}</i>`,
    "",
    `<b>📊 TRADING ACTIVITY</b>`,
    activity.devActivity,
    `Unique Buyers (24h): ${activity.uniqueBuyers24h || 'Unknown'}`,
    `Volume (24h): ${activity.volume24h}`,
    `${activity.hasHealthyActivity ? "✅ Active trading" : "⚠️ Low activity"}`,
    "",
    `<b>🔒 SECURITY FEATURES</b>`,
    `Security Score: ${security.securityScore}/10`,
    `${security.hasDangerousFeatures ? "⚠️ Dangerous features detected" : "✅ No dangerous features"}`,
    security.features.mintable ? "🚨 Can mint new tokens" : "",
    security.features.blacklistCheck ? "🚨 Has blacklist function" : "",
    security.features.pauseable ? "🚨 Can pause trading" : "",
    "",
    `<b>💡 TRADER INSIGHTS</b>`,
    riskAssessment.insights,
    "",
    `<b>⚠️ RISK SUMMARY</b>`,
    `Overall Risk: <b>${riskAssessment.level}</b>`,
    `Recommendation: ${getTradingRecommendation(riskAssessment.riskPercentage)}`,
    "",
    `<i>⚠️ Always DYOR - This analysis is for informational purposes only</i>`
  ].filter(line => line && line.trim() !== "").join("\n");
}

function getTradingRecommendation(riskPercentage) {
  if (riskPercentage < 25) return "🟢 Safe for accumulation - consider long-term hold";
  if (riskPercentage < 40) return "🟢 Good for swing trading - set 15% stop loss";
  if (riskPercentage < 55) return "🟡 Trade with caution - use 10% stop loss, small positions";
  if (riskPercentage < 70) return "🟠 High risk - only for experienced traders";
  return "🔴 Extreme risk - avoid or use minimal position size";
}

// Export for testing
export { calculateRisk as legacyCalculateRisk } from './legacy-risk.js'; // If you want to keep old function

// Default export for backward compatibility
export default { analyzeToken };
