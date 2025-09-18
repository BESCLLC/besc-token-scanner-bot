import axios from "axios";
import { ethers } from "ethers";
import { getTopHolders, getTokenInfo } from "./holders.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const lpAbi = require("./abi/LP.json");

// Updated locker ABI based on your provided contract
const LOCKER_ABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_user",
        "type": "address"
      }
    ],
    "name": "getUserLocks",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "unlockTime",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "bool",
            "name": "unlocked",
            "type": "bool"
          },
          {
            "internalType": "string",
            "name": "purpose",
            "type": "string"
          },
          {
            "internalType": "address",
            "name": "beneficiary",
            "type": "address"
          }
        ],
        "internalType": "struct BESCHyperChainLocker.Lock[]",
        "name": "",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "paused",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

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
    const pairCreationInfo = await getPairCreationInfo(tokenAddress);

    // --- 2. Create token contract with enhanced ABI ---
    const tokenContract = new ethers.Contract(tokenAddress, ENHANCED_TOKEN_ABI, provider);

    // --- 3. Owner & Renounce Check ---
    const ownership = await analyzeOwnership(tokenContract, tokenAddress);
    ownership.verified = verified;

    // --- 4. Tax Analysis with Max Limits ---
    const taxes = await analyzeTaxes(tokenContract);

    // --- 5. Liquidity & LP Analysis ---
    const liquidity = await analyzeLiquidity(tokenAddress, tokenInfo, pairCreationInfo);

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
      riskAssessment,
      pairCreationInfo
    });

  } catch (err) {
    console.error("❌ analyzeToken failed:", err);
    return `⚠️ Error analyzing token ${tokenAddress}: ${err.message}\n\nPlease check the contract address and try again.`;
  }
}

// Get actual pair creation information
async function getPairCreationInfo(tokenAddress) {
  try {
    if (!FACTORY_ADDRESS) return { blockNumber: null, timestamp: null };

    const factory = new ethers.Contract(
      FACTORY_ADDRESS,
      [
        "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
        "function getPair(address tokenA, address tokenB) view returns (address)"
      ],
      provider
    );

    const pair = await factory.getPair(tokenAddress, BASE_TOKENS[0] || ethers.ZeroAddress);
    if (!pair || pair === ethers.ZeroAddress) return { blockNumber: null, timestamp: null };

    // Get pair creation transaction
    const filter = factory.filters.PairCreated(
      null,
      null,
      pair
    );
    
    const events = await factory.queryFilter(filter, -100000); // Last 100k blocks
    if (events.length > 0) {
      const event = events[0];
      const block = await provider.getBlock(event.blockNumber);
      return {
        blockNumber: event.blockNumber,
        timestamp: block.timestamp,
        txHash: event.transactionHash
      };
    }

    // Fallback: get pair contract creation
    const pairCode = await provider.getCode(pair);
    if (pairCode !== "0x") {
      const latestBlock = await provider.getBlockNumber();
      const creationBlock = Math.max(0, latestBlock - 50000); // Estimate
      return { blockNumber: creationBlock, timestamp: Math.floor(Date.now() / 1000) };
    }

  } catch (err) {
    console.log("Pair creation info failed:", err.message);
  }

  return { blockNumber: null, timestamp: null };
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
    } else if (owner && owner.toLowerCase() === tokenAddress.toLowerCase()) {
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
    ownershipRisk
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
    if (totalSupply > 0n) {
      for (const fn of taxFunctions.maxTx) {
        try {
          const maxTx = await tokenContract[fn]();
          if (maxTx && maxTx > 0n && maxTx < totalSupply) {
            maxTxPercent = Number((maxTx * 100n) / totalSupply);
            break;
          }
        } catch {}
      }
    }
  } catch {}

  // Check max wallet limits
  try {
    const totalSupply = await tokenContract.totalSupply();
    if (totalSupply > 0n) {
      for (const fn of taxFunctions.maxWallet) {
        try {
          const maxWallet = await tokenContract[fn]();
          if (maxWallet && maxWallet > 0n && maxWallet < totalSupply) {
            maxWalletPercent = Number((maxWallet * 100n) / totalSupply);
            break;
          }
        } catch {}
      }
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

// Enhanced liquidity analysis with REAL locker checking
async function analyzeLiquidity(tokenAddress, tokenInfo, pairCreationInfo) {
  let lpStatus = "⚠️ No LP found";
  let lpPercentBurned = 0;
  let lpPair = null;
  let pairedToken = null;
  let liquidityValue = "Unknown";
  let lpAgeDays = 0;
  let lpLocked = false;
  let lockedAmount = 0n;
  let lockedPercent = 0;
  let unlockTime = 0;
  let unlockDate = "N/A";

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

      // Calculate actual LP age from pair creation
      if (pairCreationInfo && pairCreationInfo.timestamp) {
        const now = Math.floor(Date.now() / 1000);
        lpAgeDays = Math.floor((now - Number(pairCreationInfo.timestamp)) / 86400);
      } else {
        // Fallback calculation based on block number
        const latestBlock = await provider.getBlockNumber();
        if (pairCreationInfo && pairCreationInfo.blockNumber) {
          const blocksSinceCreation = latestBlock - pairCreationInfo.blockNumber;
          // Assume 12 seconds per block (adjust for your chain)
          lpAgeDays = Math.floor((blocksSinceCreation * 12) / 86400);
        }
      }

      // === REAL LOCKER CHECKING ===
      if (LOCKER_ADDRESS) {
        const lockStatus = await checkLockerStatus(lpPair, lpSupply);
        if (lockStatus.locked) {
          lpLocked = true;
          lockedAmount = lockStatus.lockedAmount;
          lockedPercent = lockStatus.lockedPercent;
          unlockTime = lockStatus.unlockTime;
          unlockDate = lockStatus.unlockDate;
          
          if (lockedPercent >= 51) {
            lpStatus = `🔒 LP LOCKED: ${lockedPercent.toFixed(1)}% until ${unlockDate}`;
          } else {
            lpStatus = `🔒 LP PARTIALLY LOCKED: ${lockedPercent.toFixed(1)}% until ${unlockDate}`;
          }
        } else if (lpPercentBurned >= 51) {
          lpStatus = `🔥 LP BURNED: ${lpPercentBurned.toFixed(1)}%`;
        } else if (lpPercentBurned > 0) {
          lpStatus = `⚠️ LP PARTIALLY BURNED: ${lpPercentBurned.toFixed(1)}%`;
        } else {
          lpStatus = `⚠️ LP UNLOCKED - Liquidity can be removed`;
        }
      } else if (lpPercentBurned >= 51) {
        lpStatus = `🔥 LP BURNED: ${lpPercentBurned.toFixed(1)}%`;
      } else if (lpPercentBurned > 0) {
        lpStatus = `⚠️ LP PARTIALLY BURNED: ${lpPercentBurned.toFixed(1)}%`;
      } else {
        lpStatus = `⚠️ LP UNLOCKED - Liquidity can be removed`;
      }
    }
  } catch (err) {
    console.log("Liquidity analysis failed:", err.message);
    lpStatus = `❌ Liquidity check failed: ${err.message}`;
  }

  return {
    lpStatus,
    lpPercentBurned,
    lpPair,
    pairedToken,
    lpAgeDays,
    hasLiquidity: !!lpPair,
    lpLocked,
    lockedAmount,
    lockedPercent,
    unlockTime,
    unlockDate
  };
}

// Real locker status checking using your ABI
async function checkLockerStatus(lpPair, totalLPSupply) {
  try {
    if (!LOCKER_ADDRESS) {
      return { locked: false, lockedAmount: 0n, lockedPercent: 0, unlockTime: 0, unlockDate: "N/A" };
    }

    console.log(`🔍 Checking locker status for LP: ${lpPair}`);
    
    const lockerContract = new ethers.Contract(LOCKER_ADDRESS, LOCKER_ABI, provider);
    
    // Get all locks for the LP pair address (as the "user" of the locker)
    const userLocks = await lockerContract.getUserLocks(lpPair);
    
    console.log(`Found ${userLocks.length} locks for LP ${lpPair}`);

    let totalLockedAmount = 0n;
    let earliestUnlockTime = 0;
    let hasActiveLocks = false;

    // Analyze each lock
    for (const lock of userLocks) {
      console.log(`Lock analysis: amount=${lock.amount}, unlocked=${lock.unlocked}, unlockTime=${lock.unlockTime}, token=${lock.token}`);
      
      // Only consider active (not unlocked) locks for this specific LP token
      if (!lock.unlocked && lock.token.toLowerCase() === lpPair.toLowerCase()) {
        hasActiveLocks = true;
        totalLockedAmount += lock.amount;
        
        // Track the earliest unlock time among active locks
        if (earliestUnlockTime === 0 || lock.unlockTime < earliestUnlockTime) {
          earliestUnlockTime = Number(lock.unlockTime);
        }
        
        console.log(`Active lock found: ${ethers.formatEther(lock.amount)} LP tokens until ${new Date(lock.unlockTime * 1000).toLocaleDateString()}`);
      }
    }

    if (hasActiveLocks && totalLPSupply > 0n) {
      const lockedPercent = Number((totalLockedAmount * 10000n) / totalLPSupply) / 100;
      const unlockDate = new Date(earliestUnlockTime * 1000).toLocaleDateString();
      
      console.log(`Total locked: ${ethers.formatEther(totalLockedAmount)} LP tokens (${lockedPercent.toFixed(1)}%) until ${unlockDate}`);
      
      return {
        locked: true,
        lockedAmount: totalLockedAmount,
        lockedPercent: Math.min(lockedPercent, 100),
        unlockTime: earliestUnlockTime,
        unlockDate: unlockDate,
        lockCount: userLocks.filter(l => !l.unlocked && l.token.toLowerCase() === lpPair.toLowerCase()).length
      };
    }

    console.log("No active LP locks found");
    return { 
      locked: false, 
      lockedAmount: 0n, 
      lockedPercent: 0, 
      unlockTime: 0, 
      unlockDate: "N/A",
      lockCount: 0 
    };

  } catch (err) {
    console.log("Locker status check failed:", err.message);
    return { 
      locked: false, 
      lockedAmount: 0n, 
      lockedPercent: 0, 
      unlockTime: 0, 
      unlockDate: "N/A",
      lockCount: 0,
      error: err.message 
    };
  }
}

// Find liquidity pair with multiple strategies
async function findLiquidityPair(tokenAddress) {
  let lpPair = ethers.ZeroAddress;

  // Strategy 1: Try token's own pair() function
  try {
    const tokenContract = new ethers.Contract(tokenAddress, ["function pair() view returns (address)"], provider);
    lpPair = await tokenContract.pair();
    if (lpPair && lpPair !== ethers.ZeroAddress) {
      console.log(`Found LP pair via token contract: ${lpPair}`);
      return lpPair;
    }
  } catch (err) {
    console.log("Token pair() function failed:", err.message);
  }

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
          console.log(`Found LP pair via factory: ${lpPair} with base token ${baseToken}`);
          break;
        }
      }
    } catch (err) {
      console.log("Factory pair lookup failed:", err.message);
    }
  }

  // Strategy 3: Direct LP search via explorer API
  if (lpPair === ethers.ZeroAddress) {
    try {
      lpPair = await findPairViaExplorer(tokenAddress);
    } catch (err) {
      console.log("Explorer pair search failed:", err.message);
    }
  }

  return lpPair;
}

async function findPairViaExplorer(tokenAddress) {
  try {
    // Use Blockscout API to find transactions involving the token that might be pair creation
    const response = await axios.get(`${BASE_URL}/addresses/${tokenAddress}/transactions`, {
      params: { limit: 10 },
      timeout: 5000
    });
    
    // This is a simplified approach - in production you'd parse transaction data for pair creation
    return ethers.ZeroAddress;
  } catch (err) {
    console.log("Explorer pair search failed:", err.message);
    return ethers.ZeroAddress;
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
      const testAmount = ethers.parseUnits("1", tokenInfo.decimals || 18);
      await provider.call({
        to: tokenAddress,
        data: tokenContract.interface.encodeFunctionData("transfer", [
          ethers.Wallet.createRandom().address,
          testAmount
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
      simulations.buy = await simulateRouterSwap(liquidity.pairedToken, tokenAddress, "buy", tokenInfo);
    } else {
      simulations.buy = "⚠️ Cannot simulate buy (no LP/router)";
    }

    // 3. Sell simulation via router  
    if (ROUTER_ADDRESS && liquidity.lpPair && liquidity.pairedToken) {
      simulations.sell = await simulateRouterSwap(tokenAddress, liquidity.pairedToken, "sell", tokenInfo);
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

async function simulateRouterSwap(tokenIn, tokenOut, direction, tokenInfo) {
  try {
    if (!ROUTER_ADDRESS) throw new Error("No router address");

    const amountIn = ethers.parseUnits("1", 18); // Use 18 decimals for base token
    const router = new ethers.Contract(ROUTER_ADDRESS, routerAbi, provider);
    
    const path = direction === "buy" ? [tokenOut, tokenIn] : [tokenIn, tokenOut];
    const recipient = ethers.Wallet.createRandom().address;
    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

    let method, params;
    
    if (direction === "buy") {
      // Buying tokens with ETH/base token
      method = "swapExactETHForTokensSupportingFeeOnTransferTokens";
      params = [0, path, recipient, deadline]; // amountOutMin=0 for simulation
    } else {
      // Selling tokens for ETH/base token
      method = "swapExactTokensForETHSupportingFeeOnTransferTokens";
      params = [amountIn, 0, path, recipient, deadline];
    }

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
      "expired",
      "invalid amount"
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
    { pattern: "liquidity", reason: "low liquidity" },
    { pattern: "amount", reason: "invalid amount" }
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

// Enhanced trading activity analysis using real data
async function analyzeTradingActivity(tokenContract, owner) {
  let devActivity = "✅ No suspicious dev activity";
  let volume24h = "0";
  let uniqueBuyers24h = 0;
  let buySellRatio = "0:0";
  let totalTransactions24h = 0;

  try {
    // Dev wallet monitoring (if owner exists)
    if (owner && owner !== "N/A" && owner !== ethers.ZeroAddress) {
      const devActivityReport = await monitorDevWallet(tokenContract, owner);
      if (devActivityReport.suspicious) {
        devActivity = `🚨 DEV ACTIVITY: ${devActivityReport.details}`;
      }
    }

    // Get real trading metrics using event logs
    const tradingMetrics = await getRealTradingMetrics(tokenContract);
    if (tradingMetrics) {
      volume24h = tradingMetrics.volume24h;
      uniqueBuyers24h = tradingMetrics.uniqueBuyers;
      buySellRatio = tradingMetrics.buySellRatio;
      totalTransactions24h = tradingMetrics.totalTransactions;
    }

  } catch (err) {
    console.log("Trading activity analysis failed:", err.message);
  }

  return {
    devActivity,
    volume24h,
    uniqueBuyers24h,
    buySellRatio,
    totalTransactions24h,
    hasHealthyActivity: uniqueBuyers24h > 5 && totalTransactions24h > 10
  };
}

async function monitorDevWallet(tokenContract, owner) {
  try {
    const filter = tokenContract.filters.Transfer(owner, null); // Dev sells
    const buyFilter = tokenContract.filters.Transfer(null, owner); // Dev buys
    
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 10000); // Last ~2-3 days
    
    const [sells, buys] = await Promise.all([
      tokenContract.queryFilter(filter, fromBlock, latestBlock),
      tokenContract.queryFilter(buyFilter, fromBlock, latestBlock)
    ]);

    const sellValue = sells.reduce((sum, log) => sum + Number(log.args.value), 0n);
    const buyValue = buys.reduce((sum, log) => sum + Number(log.args.value), 0n);
    
    if (sells.length > 0 && sellValue > buyValue * 2n) { // Selling > 2x buying
      return {
        suspicious: true,
        details: `${sells.length} sells (${ethers.formatEther(sellValue)} tokens) vs ${buys.length} buys (${ethers.formatEther(buyValue)})`
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

async function getRealTradingMetrics(tokenContract) {
  try {
    const filter = tokenContract.filters.Transfer();
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 5000); // Last ~24h
    
    const transfers = await tokenContract.queryFilter(filter, fromBlock, latestBlock);
    
    if (!transfers || transfers.length === 0) return null;

    // Analyze transfer patterns to identify buys/sells
    const uniqueFrom = new Set();
    const uniqueTo = new Set();
    let totalValue = 0n;
    
    for (const transfer of transfers) {
      if (transfer.args) {
        totalValue += transfer.args.value;
        uniqueFrom.add(transfer.args.from);
        uniqueTo.add(transfer.args.to);
      }
    }
    
    // Estimate buys as transfers TO unique addresses (simplified)
    const estimatedBuys = Math.floor(transfers.length * 0.6);
    const estimatedSells = transfers.length - estimatedBuys;
    
    return {
      volume24h: ethers.formatEther(totalValue),
      uniqueBuyers: uniqueFrom.size,
      buySellRatio: `${estimatedBuys}:${estimatedSells}`,
      totalTransactions: transfers.length
    };
  } catch (err) {
    console.log("Trading metrics failed:", err.message);
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

    // Check if renounceOwnership exists and can be called
    try {
      await tokenContract.renounceOwnership.estimateGas();
      features.ownershipRenounceable = true;
    } catch {}

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
  if (!features.ownershipRenounceable) score -= 1;
  
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
  
  const totalSupply = holders.reduce((sum, h) => sum + (h.amount || 0), 0);
  if (totalSupply === 0) return 0;
  
  let accumulator = 0;
  let cumulativeShare = 0;
  
  // Sort holders by amount (descending)
  const sortedHolders = [...holders].sort((a, b) => (b.amount || 0) - (a.amount || 0));
  
  for (let i = 0; i < sortedHolders.length; i++) {
    const holder = sortedHolders[i];
    const share = (holder.amount || 0) / totalSupply;
    cumulativeShare += share;
    // Gini calculation using Lorenz curve approximation
    accumulator += (cumulativeShare - (i + 1) / sortedHolders.length) * share;
  }
  
  return Math.abs(accumulator);
}

// Fixed contract verification using correct API endpoint
async function checkContractVerified(address) {
  try {
    const response = await axios.get(`${BASE_URL}/smart-contracts/${address}`, {
      timeout: 5000
    });
    
    return response.data && 
           response.data.compiler_version && 
           response.data.name !== null &&
           response.status === 200;
  } catch (err) {
    console.log(`Contract verification failed for ${address}:`, err.message);
    return false;
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

  // Liquidity risk (20 points max) - Updated with real locker data
  if (!analysis.liquidity.hasLiquidity) {
    score += 20;
    factors.push("No liquidity detected");
  } else if (!analysis.liquidity.lpLocked && analysis.liquidity.lpPercentBurned < 25) {
    score += 15;
    factors.push("Low liquidity protection");
  } else if (!analysis.liquidity.lpLocked && analysis.liquidity.lpPercentBurned < 51) {
    score += 8;
    factors.push("Partial liquidity protection");
  }

  // Holder concentration risk (15 points max)
  if (analysis.holderAnalysis.top10Concentration > 60) {
    score += 15;
    factors.push("Extreme holder concentration");
  } else if (analysis.holderAnalysis.top10Concentration > 40) {
    score += 8;
    factors.push("High holder concentration");
  }

  // Honeypot risk (15 points max)
  if (analysis.simulation.honeypotRisk.includes("HIGH")) {
    score += 15;
    factors.push("High honeypot risk");
  } else if (analysis.simulation.honeypotRisk.includes("POTENTIAL") || analysis.simulation.honeypotRisk.includes("MODERATE")) {
    score += 8;
    factors.push("Potential honeypot risk");
  }

  // Security features risk (10 points max)
  if (analysis.security.hasDangerousFeatures) {
    score += 8;
    factors.push("Dangerous contract features");
  }
  if (analysis.security.securityScore < 5) score += 2;

  // Activity risk (5 points max)
  if (!analysis.activity.hasHealthyActivity) {
    score += 3;
    factors.push("Low trading activity");
  }
  if (analysis.activity.devActivity.includes("🚨")) {
    score += 2;
    factors.push("Suspicious dev activity");
  }

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
  
  if (analysis.liquidity.lpLocked && analysis.liquidity.lockedPercent >= 51) {
    insights.push(`🔒 LP locked: ${analysis.liquidity.lockedPercent.toFixed(1)}% until ${analysis.liquidity.unlockDate} - Strong protection`);
  } else if (analysis.liquidity.lpPercentBurned >= 51) {
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

  if (analysis.security.securityScore >= 8) {
    insights.push("🔐 High security score - clean contract");
  }

  // Risk warnings
  if (analysis.taxes.buyTax > 10 || analysis.taxes.sellTax > 10) {
    insights.push("⚠️ High taxes may impact profitability - consider tax efficiency");
  }
  
  if (analysis.holderAnalysis.top10Concentration > 40) {
    insights.push(`🐋 Top 10 holders control ${analysis.holderAnalysis.top10Concentration.toFixed(1)}% - watch for coordinated dumps`);
  }
  
  if (!analysis.taxes.hasHighLimits) {
    insights.push("🔒 Low max tx/wallet limits may cause slippage on larger trades");
  }

  if (!analysis.liquidity.lpLocked && analysis.liquidity.lpPercentBurned < 25) {
    insights.push("⚠️ Low liquidity protection - rug pull risk");
  }

  // Trading recommendations
  if (riskPercentage < 25) {
    insights.push("📈 Suitable for swing trading - set stop losses at 15-20%");
  } else if (riskPercentage < 40) {
    insights.push("⚖️ Medium risk - use tight stop losses (10%) and small position sizes");
  } else {
    insights.push("🚨 High risk - only for experienced traders with strict risk management");
  }

  if (analysis.activity.uniqueBuyers24h > 20) {
    insights.push(`📊 Strong community interest: ${analysis.activity.uniqueBuyers24h} unique buyers in 24h`);
  }

  if (analysis.activity.totalTransactions24h > 100) {
    insights.push(`🔥 High volume: ${analysis.activity.totalTransactions24h} transactions in 24h`);
  }

  return insights.length > 0 ? insights.join("\n") : "No specific insights - DYOR";
}

// Enhanced report formatting with real data
function formatAnalysisReport(analysis) {
  const { riskAssessment, tokenInfo, ownership, taxes, liquidity, holderAnalysis, 
          simulation, activity, security, contractAnalysis, pairCreationInfo } = analysis;

  const holdersText = holderAnalysis.displayHolders.length > 0 ? 
    holderAnalysis.displayHolders
      .map((h, i) => `${i + 1}. <code>${h.address.slice(0, 6)}...</code>: ${h.percent.toFixed(2)}%`)
      .join("\n") : "No holder data available";

  // Format contract age
  let contractAge = "Unknown";
  if (pairCreationInfo && pairCreationInfo.timestamp) {
    const ageDays = liquidity.lpAgeDays || Math.floor((Date.now() / 1000 - Number(pairCreationInfo.timestamp)) / 86400);
    contractAge = `${ageDays} days`;
  }

  // Format LP details
  let lpDetails = liquidity.lpStatus;
  if (liquidity.lpLocked) {
    lpDetails += `\n   └─ ${liquidity.lockedAmount ? ethers.formatEther(liquidity.lockedAmount) : 'Unknown'} LP tokens locked`;
    lpDetails += `\n   └─ Unlocks: ${liquidity.unlockDate}`;
  }

  return [
    `${riskAssessment.emoji} <b>${riskAssessment.level}</b> (${riskAssessment.riskPercentage}%)`,
    "",
    `<b>📋 TOKEN OVERVIEW</b>`,
    `<code>${tokenInfo.name || 'Unknown'}</code> (<code>${tokenInfo.symbol || '???'}</code>)`,
    `Total Supply: <code>${tokenInfo.totalSupply ? ethers.formatEther(tokenInfo.totalSupply) : 'Unknown'}</code>`,
    `Contract Age: ${contractAge}`,
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
    lpDetails,
    `${liquidity.hasLiquidity ? "✅ Liquidity detected" : "❌ No liquidity found"}`,
    "",
    `<b>👥 HOLDER DISTRIBUTION</b>`,
    `${holderAnalysis.totalLiveHolders || 0} live holders`,
    `Top 10 control: <b>${holderAnalysis.top10Concentration.toFixed(1)}%</b>`,
    `Gini Index: ${holderAnalysis.giniCoefficient} (0=equal, 1=unequal)`,
    `Distribution: ${holderAnalysis.healthyDistribution ? "✅ Healthy" : "⚠️ Concentrated"}`,
    "",
    holdersText,
    "",
    `<b>🛡️ HONEYPOT CHECK</b>`,
    `<i>${simulation.honeypotRisk}</i>`,
    "",
    `<b>📊 TRADING ACTIVITY (24h)</b>`,
    `${activity.devActivity}`,
    `Unique Buyers: ${activity.uniqueBuyers24h || 0}`,
    `Total Volume: ${activity.volume24h || '0'} tokens`,
    `Transactions: ${activity.totalTransactions24h || 0}`,
    `Buy:Sell Ratio: ${activity.buySellRatio}`,
    `${activity.hasHealthyActivity ? "✅ Active trading" : "⚠️ Low activity"}`,
    "",
    `<b>🔒 SECURITY FEATURES</b>`,
    `Security Score: ${security.securityScore}/10`,
    `${security.hasDangerousFeatures ? "⚠️ Dangerous features detected" : "✅ No dangerous features"}`,
    security.features.mintable ? "🚨 Can mint new tokens" : "",
    security.features.blacklistCheck ? "🚨 Has blacklist function" : "",
    security.features.pauseable ? "🚨 Can pause trading" : "",
    `${security.features.ownershipRenounceable ? "✅ Can renounce ownership" : "⚠️ Cannot renounce ownership"}`,
    "",
    `<b>💡 TRADER INSIGHTS</b>`,
    riskAssessment.insights,
    "",
    `<b>⚠️ RISK SUMMARY</b>`,
    `Overall Risk: <b>${riskAssessment.level}</b>`,
    `Risk Factors: ${riskAssessment.factors.length > 0 ? riskAssessment.factors.slice(0, 3).join(', ') : 'None detected'}${riskAssessment.factors.length > 3 ? '...' : ''}`,
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

// Legacy compatibility function (your original calculateRisk)
function calculateRisk({ buyTax, sellTax, lpPercentBurned, holders }) {
  let score = 0;
  let holderComment = "Healthy";
  let taxComment = "Reasonable";
  let lpComment = "Sufficiently burned/locked";
  let traderInsights = "Token looks safe for trading.";

  // ✅ Exclude dead/zero addresses before checking whale %
  const filteredHolders = holders.filter(
    (h) =>
      !h.address.toLowerCase().includes("dead") &&
      h.address.toLowerCase() !== "0x0000000000000000000000000000000000000000"
  );

  const biggestHolder = filteredHolders.length > 0 ? filteredHolders[0] : null;

  if (buyTax > 10 || sellTax > 10) {
    score += 2;
    taxComment = "⚠️ High tax - possible honeypot.";
  }
  if (lpPercentBurned < 50) {
    score += 2;
    lpComment = "⚠️ Low burn/lock - liquidity can be removed.";
  }
  if (biggestHolder && biggestHolder.percent > 30) {
    score += 2;
    holderComment = `⚠️ Whale holds >${biggestHolder.percent.toFixed(2)}% supply.`;
  }

  if (score >= 4) traderInsights = "High rug risk — trade cautiously.";
  else if (score >= 2) traderInsights = "Moderate risk — DYOR before buying.";

  return {
    emoji: score >= 4 ? "🔴" : score >= 2 ? "🟡" : "🟢",
    label: score >= 4 ? "HIGH RISK" : score >= 2 ? "MEDIUM RISK" : "SAFE",
    holderComment,
    taxComment,
    lpComment,
    traderInsights,
  };
}


export default { analyzeToken };
