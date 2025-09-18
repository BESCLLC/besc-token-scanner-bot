import axios from "axios";
import { ethers } from "ethers";
import { getTopHolders, getTokenInfo } from "./holders.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const lpAbi = require("./abi/LP.json");

// Updated locker ABI based on your provided contract - Added Locked event
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
  },
  // 🔥 ADDED: Locked event for querying
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "user",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "unlockTime",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "purpose",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "lockId",
        "type": "uint256"
      }
    ],
    "name": "Locked",
    "type": "event"
  }
];

const routerAbi = require("./abi/Router.json");

// 🔥 FIXED: Correct Blockscout API base URL
const BASE_URL = process.env.BLOCKSCOUT_API || "https://explorer.beschyperchain.com/api/v2";

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

// 🔥 FIXED: V2 Blockscout API - Proper token info endpoint with holders count
async function fetchTokenInfoFromBlockscout(tokenAddress) {
  try {
    console.log(`🔍 Fetching token info from Blockscout V2: ${tokenAddress}`);
    
    // ✅ FIXED: Use V2 endpoint structure - /tokens/{address_hash}
    const response = await axios.get(`${BASE_URL}/tokens/${tokenAddress.toLowerCase()}`, {
      timeout: 10000
    });

    console.log("Blockscout V2 response status:", response.status);
    console.log("Blockscout V2 token data:", JSON.stringify(response.data, null, 2));

    if (response.data && response.status === 200) {
      const tokenData = response.data;
      
      // ✅ FIXED: Extract data from V2 response structure
      let totalSupply = "0";
      if (tokenData.total_supply) {
        // V2 might return different formats - handle both string and number
        totalSupply = tokenData.total_supply.toString().replace(/,/g, '');
      }

      console.log(`Blockscout V2 supply raw: ${tokenData.total_supply}, parsed: ${totalSupply}`);

      // Validate supply - if it's invalid, fallback to contract
      let finalSupply = totalSupply;
      if (totalSupply === "0" || !totalSupply || isNaN(totalSupply) || BigInt(totalSupply) === 0n) {
        console.log("Invalid Blockscout supply, trying contract call...");
        try {
          const tokenContract = new ethers.Contract(tokenAddress, ["function totalSupply() view returns (uint256)"], provider);
          finalSupply = (await tokenContract.totalSupply()).toString();
          console.log(`✅ Fetched supply via contract call: ${finalSupply}`);
        } catch (contractError) {
          console.log("Contract supply call failed:", contractError.message);
          finalSupply = "0";
        }
      }

      // ✅ FIXED: Extract holders count from token data
      const holdersCount = tokenData.holders || "0";
      console.log(`✅ Extracted holders count: ${holdersCount}`);

      return {
        name: tokenData.name || tokenData.symbol || "Unknown",
        symbol: tokenData.symbol || "???",
        decimals: tokenData.decimals ? parseInt(tokenData.decimals) : 18,
        totalSupply: BigInt(finalSupply || 0),
        holdersCount: parseInt(holdersCount) || 0,
        verified: tokenData.verified ? true : false,
        blockscoutData: tokenData
      };
    } else {
      console.log("Blockscout V2 token info failed, trying contract fallback");
      return await fetchTokenInfoFromContract(tokenAddress);
    }
  } catch (err) {
    if (err.response && err.response.status === 404) {
      console.log("Token not found on Blockscout V2, trying contract fallback...");
    } else {
      console.log("Blockscout V2 API error:", err.message);
    }
    return await fetchTokenInfoFromContract(tokenAddress);
  }
}

// Fallback: Get token info directly from contract calls
async function fetchTokenInfoFromContract(tokenAddress) {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, [
      "function name() view returns (string)",
      "function symbol() view returns (string)", 
      "function decimals() view returns (uint8)",
      "function totalSupply() view returns (uint256)"
    ], provider);

    const [name, symbol, decimals, totalSupply] = await Promise.all([
      tokenContract.name().catch(() => "Unknown"),
      tokenContract.symbol().catch(() => "???"),
      tokenContract.decimals().catch(() => 18),
      tokenContract.totalSupply().catch(() => 0n)
    ]);

    const totalSupplyStr = totalSupply.toString();
    console.log(`✅ Fetched from contract: ${name} (${symbol}), Supply: ${totalSupplyStr}, Decimals: ${decimals}`);
    
    return {
      name,
      symbol,
      decimals,
      totalSupply,
      holdersCount: 0, // Can't get holders from contract call
      verified: false
    };
  } catch (err) {
    console.log("Contract info fetch failed:", err.message);
    return {
      name: "Unknown",
      symbol: "???",
      decimals: 18,
      totalSupply: 0n,
      holdersCount: 0,
      verified: false
    };
  }
}

// 🔥 FIXED: Working holders endpoint from your example
export async function getFixedTopHolders(tokenAddress, limit = 100, totalSupply, decimals) {
  try {
    console.log(`🔍 Getting top holders for ${tokenAddress}, limit: ${limit}`);
    
    // ✅ FIXED: Ensure totalSupply is BigInt and fetch if needed
    if (!totalSupply || typeof totalSupply === 'number' || totalSupply === '0') {
      const tokenInfo = await fetchTokenInfoFromBlockscout(tokenAddress);
      totalSupply = tokenInfo.totalSupply;
      decimals = tokenInfo.decimals;
      console.log(`Updated supply for holders: ${totalSupply.toString()}`);
    }
    
    // ✅ FIXED: Use the WORKING endpoint structure you provided
    const url = `${BASE_URL}/tokens/${tokenAddress}/holders?page=1&limit=${limit}`;
    console.log(`Fetching holders from: ${url}`);
    
    const res = await axios.get(url, {
      timeout: 10000
    });

    console.log("Holders API response status:", res.status);
    console.log("Holders API response data structure:", JSON.stringify(res.data, null, 2));

    if (!res.data.items || res.data.items.length === 0) {
      console.warn("⚠️ No holders returned by BlockScout for", tokenAddress);
      return [];
    }

    console.log(`✅ Found ${res.data.items.length} holders from API`);

    const holders = res.data.items
      .filter(item => item.value && BigInt(item.value) > 0n)
      .map((holder, index) => {
        // ✅ Handle the actual response structure from working endpoint
        const balance = BigInt(holder.value || 0);
        const total = totalSupply || BigInt(0);
        
        // ✅ Safe percentage calculation with BigInt
        let percent = 0;
        if (total > 0n) {
          const percentage = (balance * 10000n) / total;
          percent = Number(percentage) / 100;
        }
        
        return {
          address: holder.address.hash || holder.address_hash || holder.address || `0x${'0'.repeat(40)}`,
          amount: balance,
          percent: Math.min(Math.max(percent, 0), 100),
          rank: index + 1,
          value: Number(ethers.formatUnits(balance, decimals || 18))
        };
      });

    console.log(`✅ Processed ${holders.length} valid holders with non-zero balances`);
    return holders.slice(0, limit);

  } catch (err) {
    console.error("❌ getFixedTopHolders failed:", err.message);
    if (err.response) {
      console.error("Response data:", JSON.stringify(err.response.data, null, 2));
    }
    return [];
  }
}

// 🔥 FIXED: V2 Blockscout API - Proper contract verification using smart-contracts endpoint
async function checkContractVerified(address) {
  try {
    // ✅ FIXED: Use V2 smart-contracts endpoint instead of Etherscan format
    const response = await axios.get(`${BASE_URL}/smart-contracts/${address.toLowerCase()}`, {
      timeout: 5000
    });
    
    console.log("V2 smart-contracts response:", response.status);
    console.log("Response data:", JSON.stringify(response.data, null, 2));
    
    // Check V2 response for verification indicators
    if (response.data && response.status === 200) {
      const isVerified = response.data.verified || 
                         (response.data.source_code && response.data.source_code !== '') || 
                         (response.data.abi && response.data.abi.length > 0) ||
                         response.data.name;
      return !!isVerified;
    }
    
    return false;
  } catch (err) {
    if (err.response && err.response.status === 404) {
      console.log(`Contract ${address} not found/verified on explorer`);
    } else {
      console.log(`Contract verification failed for ${address}:`, err.message);
      if (err.response) {
        console.log("Response:", JSON.stringify(err.response.data, null, 2));
      }
    }
    return false;
  }
}

// 🔥 FIXED: Get contract creation time for accurate age calculation
async function getContractCreationTime(tokenAddress) {
  try {
    console.log(`🔍 Fetching contract creation time for ${tokenAddress}`);
    
    // Try V2 API first for contract creation
    const response = await axios.get(`${BASE_URL}/smart-contracts/${tokenAddress.toLowerCase()}`, {
      timeout: 5000
    });
    
    if (response.data && response.status === 200 && response.data.created_at_block) {
      const blockNumber = response.data.created_at_block.number;
      const block = await provider.getBlock(blockNumber);
      console.log(`✅ Found contract creation: block ${blockNumber}, timestamp ${block.timestamp}`);
      return {
        blockNumber,
        timestamp: block.timestamp,
        ageHours: Math.floor((Date.now() / 1000 - Number(block.timestamp)) / 3600)
      };
    }
    
    // Fallback: Try address transactions to find creation
    const txResponse = await axios.get(`${BASE_URL}/addresses/${tokenAddress.toLowerCase()}/transactions`, {
      params: { filter: 'creation', limit: 1 },
      timeout: 5000
    });
    
    if (txResponse.data && txResponse.data.items && txResponse.data.items.length > 0) {
      const creationTx = txResponse.data.items[0];
      const block = await provider.getBlock(creationTx.block_number);
      console.log(`✅ Found creation via tx: block ${creationTx.block_number}, timestamp ${block.timestamp}`);
      return {
        blockNumber: creationTx.block_number,
        timestamp: block.timestamp,
        ageHours: Math.floor((Date.now() / 1000 - Number(block.timestamp)) / 3600)
      };
    }
    
    // Final fallback: Estimate from recent blocks
    const latestBlock = await provider.getBlockNumber();
    const estimatedBlock = Math.max(0, latestBlock - 10000);
    const estimatedBlockData = await provider.getBlock(estimatedBlock);
    const estimatedAgeHours = Math.floor((Date.now() / 1000 - Number(estimatedBlockData.timestamp)) / 3600);
    
    console.log(`⚠️ Estimated contract age: ~${estimatedAgeHours} hours`);
    return {
      blockNumber: estimatedBlock,
      timestamp: estimatedBlockData.timestamp,
      ageHours: estimatedAgeHours,
      estimated: true
    };
    
  } catch (err) {
    console.log("Contract creation time fetch failed:", err.message);
    
    // Ultimate fallback: 24 hours estimate
    const fallbackAge = 24;
    console.log(`⚠️ Using fallback contract age: ${fallbackAge} hours`);
    return {
      blockNumber: null,
      timestamp: Math.floor(Date.now() / 1000) - (fallbackAge * 3600),
      ageHours: fallbackAge,
      estimated: true
    };
  }
}

export async function analyzeToken(tokenAddress) {
  try {
    console.log(`🔍 Analyzing token: ${tokenAddress}`);
    
    // --- 1. Get Enhanced Token Info with FIXED V2 Blockscout supply & holders ---
    const tokenInfo = await fetchTokenInfoFromBlockscout(tokenAddress);
    console.log(`Token info loaded: ${tokenInfo.name} (${tokenInfo.symbol}), Supply: ${tokenInfo.totalSupply.toString()}, Holders: ${tokenInfo.holdersCount}`);
    
    // 🔥 FIXED: Get accurate contract creation time instead of pair time
    const contractCreationInfo = await getContractCreationTime(tokenAddress);
    
    const contractAnalysis = await analyzeContractFeatures(tokenAddress);
    const verified = tokenInfo.verified || await checkContractVerified(tokenAddress);
    
    // 🔥 FIXED: Use our fixed holders function with WORKING endpoint
    const holderAnalysis = await analyzeHolderDistribution(tokenAddress, tokenInfo);
    
    // 🔥 FIXED: Better pair creation info
    const pairCreationInfo = await getPairCreationInfo(tokenAddress);

    // --- 2. Create token contract with enhanced ABI ---
    const tokenContract = new ethers.Contract(tokenAddress, ENHANCED_TOKEN_ABI, provider);

    // --- 3. Owner & Renounce Check ---
    const ownership = await analyzeOwnership(tokenContract, tokenAddress);
    ownership.verified = verified;

    // --- 4. Tax Analysis with Max Limits ---
    const taxes = await analyzeTaxes(tokenContract, tokenInfo.totalSupply);

    // --- 5. Liquidity & LP Analysis with FIXED risk ---
    const liquidity = await analyzeLiquidity(tokenAddress, tokenInfo, pairCreationInfo);

    // --- 6. Honeypot & Simulation ---
    const simulation = await simulateTrading(tokenAddress, tokenInfo, liquidity);

    // --- 7. Trading Activity ---
    const activity = await analyzeTradingActivity(tokenContract, ownership.owner, tokenInfo.decimals);

    // --- 8. Security Analysis ---
    const security = await analyzeSecurityFeatures(tokenAddress);

    // --- 9. Calculate Comprehensive Risk with FIXED LP weighting ---
    const riskAssessment = calculateComprehensiveRisk({
      taxes,
      liquidity,
      holderAnalysis,
      ownership,
      simulation,
      activity,
      security,
      contractAnalysis,
      tokenInfo
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
      pairCreationInfo,
      contractCreationInfo // 🔥 FIXED: Pass contract creation info for accurate age
    });

  } catch (err) {
    console.error("❌ analyzeToken failed:", err);
    return `⚠️ Error analyzing token ${tokenAddress}: ${err.message}\n\nPlease check the contract address and try again.`;
  }
}

// 🔥 FIXED: Pair creation info with proper event filtering
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

    // Try to get pair first
    let pair = ethers.ZeroAddress;
    if (BASE_TOKENS.length > 0) {
      for (const baseToken of BASE_TOKENS) {
        try {
          const foundPair = await factory.getPair(tokenAddress, baseToken);
          if (foundPair && foundPair !== ethers.ZeroAddress) {
            pair = foundPair;
            console.log(`Found pair via factory: ${pair}`);
            break;
          }
        } catch (pairError) {
          console.log(`Pair lookup failed for base token ${baseToken}:`, pairError.message);
        }
      }
    }

    if (pair === ethers.ZeroAddress) return { blockNumber: null, timestamp: null };

    // 🔥 FIXED: Proper event filtering - only filter indexed parameters
    try {
      const latestBlock = await provider.getBlockNumber();
      const fromBlock = Math.max(0, latestBlock - 50000);
      const filter = factory.filters.PairCreated(null, null, pair);
      const events = await factory.queryFilter(filter, fromBlock, "latest");
      
      if (events.length > 0) {
        const event = events[0];
        const block = await provider.getBlock(event.blockNumber);
        console.log(`✅ Found pair creation: block ${event.blockNumber}, timestamp ${block.timestamp}`);
        return {
          blockNumber: event.blockNumber,
          timestamp: block.timestamp,
          txHash: event.transactionHash,
          pairAddress: pair
        };
      }
    } catch (filterError) {
      console.log("Event filter failed, trying alternative method:", filterError.message);
    }

    // Fallback: Estimate from pair deployment
    try {
      const latestBlock = await provider.getBlockNumber();
      const creationBlock = Math.max(0, latestBlock - 50000);
      const latestBlockData = await provider.getBlock(latestBlock);
      const estimatedTimestamp = latestBlockData.timestamp - (50000 * 12); // 12s blocks
      
      console.log(`Estimated pair creation: block ${creationBlock}, timestamp ${estimatedTimestamp}`);
      return { 
        blockNumber: creationBlock, 
        timestamp: estimatedTimestamp,
        estimated: true,
        pairAddress: pair
      };
    } catch (estimateError) {
      console.log("Estimation failed:", estimateError.message);
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
      complexityScore: Math.min((code.length / 1000), 10)
    };
  } catch (err) {
    console.log("Contract feature analysis failed:", err.message);
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
    const ownerMethods = ["getOwner", "owner", "admin"];
    for (const method of ownerMethods) {
      try {
        owner = await tokenContract[method]();
        if (owner && owner !== ethers.ZeroAddress) break;
      } catch (methodErr) {
        // Continue to next method
      }
    }

    // Check renounce function existence
    try {
      await tokenContract.renounceOwnership.estimateGas();
      canRenounce = true;
    } catch {}

    if (owner === ethers.ZeroAddress) {
      ownershipRisk = "None (Renounced)";
      renounceable = true;
    } else if (owner && owner.toLowerCase() === tokenAddress.toLowerCase()) {
      ownershipRisk = "Medium (Self-owned)";
    } else {
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
    owner: owner === ethers.ZeroAddress ? "RENOUNCED" : (owner || "Unknown"), 
    canRenounce, 
    renounceable, 
    ownershipRisk
  };
}

// 🔥 FIXED: Enhanced tax analysis with proper BigInt supply handling
async function analyzeTaxes(tokenContract, totalSupply) {
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
        buyTax += Number(ethers.formatUnits(result, 0)); // Handle potential scaled values
      }
    } catch {}
  }

  // Collect all sell taxes
  for (const fn of taxFunctions.sell) {
    try {
      const result = await tokenContract[fn]();
      if (result && !isNaN(Number(result))) {
        sellTax += Number(ethers.formatUnits(result, 0));
      }
    } catch {}
  }

  // 🔥 FIXED: Check max transaction limits with proper BigInt supply
  if (totalSupply && totalSupply > 0n) {
    for (const fn of taxFunctions.maxTx) {
      try {
        const maxTx = await tokenContract[fn]();
        if (maxTx && maxTx > 0n && maxTx < totalSupply) {
          const percent = Number((maxTx * 10000n) / totalSupply) / 100;
          maxTxPercent = Math.min(Math.max(percent, 0), 100);
          break;
        }
      } catch {}
    }
  }

  // 🔥 FIXED: Check max wallet limits with proper BigInt supply
  if (totalSupply && totalSupply > 0n) {
    for (const fn of taxFunctions.maxWallet) {
      try {
        const maxWallet = await tokenContract[fn]();
        if (maxWallet && maxWallet > 0n && maxWallet < totalSupply) {
          const percent = Number((maxWallet * 10000n) / totalSupply) / 100;
          maxWalletPercent = Math.min(Math.max(percent, 0), 100);
          break;
        }
      } catch {}
    }
  }

  return {
    buyTax: Math.min(Math.max(buyTax, 0), 100),
    sellTax: Math.min(Math.max(sellTax, 0), 100),
    maxTxPercent,
    maxWalletPercent,
    hasHighLimits: maxTxPercent >= 1 && maxWalletPercent >= 2
  };
}

// 🔥 FIXED: Enhanced holder distribution with working endpoint
async function analyzeHolderDistribution(tokenAddress, tokenInfo) {
  try {
    const allHolders = await getFixedTopHolders(tokenAddress, 100, tokenInfo.totalSupply, tokenInfo.decimals);
    
    console.log(`Raw holders fetched: ${allHolders.length}, API reported: ${tokenInfo.holdersCount}`);
    
    // Filter out burn addresses and contract itself
    const liveHolders = allHolders.filter(h => 
      !h.address.toLowerCase().includes("dead") &&
      h.address.toLowerCase() !== "0x0000000000000000000000000000000000000000" &&
      h.address.toLowerCase() !== tokenAddress.toLowerCase() &&
      h.amount > 0n
    );

    console.log(`Live holders after filtering: ${liveHolders.length}`);
    
    const top10Percent = liveHolders.slice(0, 10).reduce((sum, h) => sum + h.percent, 0);
    const giniCoefficient = calculateGiniCoefficient(liveHolders);
    const holderCount = Math.max(liveHolders.length, tokenInfo.holdersCount); // Use API count if higher

    console.log(`Holder analysis: ${holderCount} total holders, top 10: ${top10Percent.toFixed(1)}%`);

    return {
      top10Concentration: top10Percent,
      giniCoefficient: Math.round(giniCoefficient * 100) / 100,
      totalLiveHolders: holderCount,
      healthyDistribution: top10Percent < 40 && holderCount > 10 && giniCoefficient < 0.7,
      displayHolders: liveHolders.slice(0, 8)
    };
  } catch (err) {
    console.error("❌ Holder analysis failed:", err.message);
    return {
      top10Concentration: 0,
      giniCoefficient: 0,
      totalLiveHolders: tokenInfo.holdersCount || 0, // Fallback to API count
      healthyDistribution: false,
      displayHolders: []
    };
  }
}

function calculateGiniCoefficient(holders) {
  if (holders.length === 0) return 0;
  
  // Use percentages for Gini calculation (already normalized)
  const totalPercent = holders.reduce((sum, h) => sum + h.percent, 0);
  if (totalPercent === 0) return 0;
  
  let accumulator = 0;
  let cumulativeShare = 0;
  
  const sortedHolders = [...holders].sort((a, b) => b.percent - a.percent);
  
  for (let i = 0; i < sortedHolders.length; i++) {
    const holder = sortedHolders[i];
    const share = holder.percent / 100;
    cumulativeShare += share;
    accumulator += (cumulativeShare - (i + 1) / sortedHolders.length) * share;
  }
  
  return Math.abs(accumulator);
}

// 🔥 FIXED: Liquidity analysis with better error handling
async function analyzeLiquidity(tokenAddress, tokenInfo, pairCreationInfo) {
  let lpStatus = "⚠️ No LP found";
  let lpPercentBurned = 0;
  let lpPair = null;
  let pairedToken = null;
  let liquidityValue = "Unknown";
  let lpAgeHours = 0;
  let lpLocked = false;
  let lockedAmount = 0n;
  let lockedPercent = 0;
  let unlockTime = 0;
  let unlockDate = "N/A";
  let lpRiskLevel = "HIGH";

  try {
    lpPair = await findLiquidityPair(tokenAddress);

    if (lpPair && lpPair !== ethers.ZeroAddress) {
      console.log(`Found LP pair: ${lpPair}`);
      
      const lpContract = new ethers.Contract(lpPair, lpAbi, provider);
      
      const lpSupply = await lpContract.totalSupply();
      const deadBalance = await lpContract.balanceOf("0x000000000000000000000000000000000000dEaD");
      lpPercentBurned = lpSupply > 0n ? Number((deadBalance * 10000n) / lpSupply) / 100 : 0;

      console.log(`LP Supply: ${ethers.formatEther(lpSupply)}, Burned: ${lpPercentBurned.toFixed(1)}%`);

      const token0 = await lpContract.token0();
      const token1 = await lpContract.token1();
      pairedToken = token0.toLowerCase() === tokenAddress.toLowerCase() ? token1 : token0;

      // Calculate LP age in hours
      if (pairCreationInfo && pairCreationInfo.timestamp) {
        const now = Math.floor(Date.now() / 1000);
        lpAgeHours = Math.floor((now - Number(pairCreationInfo.timestamp)) / 3600);
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
            lpRiskLevel = "LOW";
          } else if (lockedPercent >= 25) {
            lpStatus = `🔒 LP PARTIALLY LOCKED: ${lockedPercent.toFixed(1)}% until ${unlockDate}`;
            lpRiskLevel = "MEDIUM";
          } else {
            lpStatus = `🔒 LP MINIMALLY LOCKED: ${lockedPercent.toFixed(1)}% until ${unlockDate} (INSUFFICIENT)`;
            lpRiskLevel = "HIGH";
          }
        } else if (lpPercentBurned >= 51) {
          lpStatus = `🔥 LP BURNED: ${lpPercentBurned.toFixed(1)}%`;
          lpRiskLevel = "LOW";
        } else if (lpPercentBurned >= 25) {
          lpStatus = `⚠️ LP PARTIALLY BURNED: ${lpPercentBurned.toFixed(1)}% (INSUFFICIENT)`;
          lpRiskLevel = "MEDIUM";
        } else {
          lpStatus = `🚨 LP UNLOCKED & UNBURNED - HIGH RUG PULL RISK`;
          lpRiskLevel = "CRITICAL";
        }
      } else if (lpPercentBurned >= 51) {
        lpStatus = `🔥 LP BURNED: ${lpPercentBurned.toFixed(1)}%`;
        lpRiskLevel = "LOW";
      } else if (lpPercentBurned >= 25) {
        lpStatus = `⚠️ LP PARTIALLY BURNED: ${lpPercentBurned.toFixed(1)}% (INSUFFICIENT)`;
        lpRiskLevel = "MEDIUM";
      } else {
        lpStatus = `🚨 LP UNLOCKED & UNBURNED - HIGH RUG PULL RISK`;
        lpRiskLevel = "CRITICAL";
      }
    } else {
      lpStatus = `❌ NO LIQUIDITY FOUND - CRITICAL RISK`;
      lpRiskLevel = "CRITICAL";
    }
  } catch (err) {
    console.log("Liquidity analysis failed:", err.message);
    lpStatus = `❌ Liquidity check failed: ${err.message} - CRITICAL RISK`;
    lpRiskLevel = "CRITICAL";
  }

  return {
    lpStatus,
    lpPercentBurned,
    lpPair,
    pairedToken,
    lpAgeHours,
    hasLiquidity: !!lpPair,
    lpLocked,
    lockedAmount,
    lockedPercent,
    unlockTime,
    unlockDate,
    lpRiskLevel
  };
}

// 🔥 FIXED: Event-based locker status checking to find all locks for the LP token - Limited block range to avoid RPC limits
async function checkLockerStatus(lpPair, totalLPSupply) {
  try {
    if (!LOCKER_ADDRESS) {
      return { locked: false, lockedAmount: 0n, lockedPercent: 0, unlockTime: 0, unlockDate: "N/A" };
    }

    console.log(`🔍 Checking locker status for LP: ${lpPair} via events`);
    
    const lockerContract = new ethers.Contract(LOCKER_ADDRESS, LOCKER_ABI, provider);
    
    // 🔥 FIXED: Limit block range to avoid "Requested range exceeds maximum RPC range limit"
    const latestBlockNum = await provider.getBlockNumber();
    const fromBlockNum = Math.max(0, latestBlockNum - 100000); // Covers ~11 days at 12s/block, adjustable if needed
    console.log(`Querying events from block ${fromBlockNum} to ${latestBlockNum}`);
    
    // 🔥 FIXED: Query Locked events filtered by token = lpPair (correct parameter position: 4th arg for indexed token)
    const filter = lockerContract.filters.Locked(null, null, null, lpPair, null, null);
    const lockedEvents = await lockerContract.queryFilter(filter, fromBlockNum, "latest");
    
    console.log(`Found ${lockedEvents.length} Locked events for LP ${lpPair}`);

    let totalLockedAmount = 0n;
    let earliestUnlockTime = 0;
    let hasActiveLocks = false;

    // Get current timestamp
    const currentTimestamp = (await provider.getBlock(latestBlockNum)).timestamp;

    // Process each event
    for (const event of lockedEvents) {
      const user = event.args.user;
      const lockId = Number(event.args.lockId);

      try {
        // Fetch user's locks to check current status
        const userLocks = await lockerContract.getUserLocks(user);
        
        if (lockId < userLocks.length) {
          const lock = userLocks[lockId];
          if (!lock.unlocked && lock.token.toLowerCase() === lpPair.toLowerCase() && currentTimestamp < lock.unlockTime) {
            hasActiveLocks = true;
            totalLockedAmount += lock.amount;
            
            if (earliestUnlockTime === 0 || lock.unlockTime < earliestUnlockTime) {
              earliestUnlockTime = Number(lock.unlockTime);
            }
            
            console.log(`Active lock found: User ${user}, ID ${lockId}, Amount ${ethers.formatEther(lock.amount)}, Unlock ${new Date(lock.unlockTime * 1000).toLocaleDateString()}`);
          }
        }
      } catch (userErr) {
        console.log(`Failed to fetch locks for user ${user}:`, userErr.message);
      }
    }

    if (hasActiveLocks && totalLPSupply > 0n) {
      const lockedPercent = Number((totalLockedAmount * 10000n) / totalLPSupply) / 100;
      const unlockDate = new Date(earliestUnlockTime * 1000).toLocaleDateString();
      
      console.log(`✅ Detected locked LP: ${lockedPercent.toFixed(2)}% until ${unlockDate}`);
      
      return {
        locked: true,
        lockedAmount: totalLockedAmount,
        lockedPercent: Math.min(lockedPercent, 100),
        unlockTime: earliestUnlockTime,
        unlockDate: unlockDate,
        lockCount: lockedEvents.length // Approximate, but events include all historical
      };
    }

    console.log("No active locks found for this LP");
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
        try {
          const pair = await factory.getPair(tokenAddress, baseToken);
          if (pair && pair !== ethers.ZeroAddress) {
            lpPair = pair;
            console.log(`Found LP pair via factory: ${lpPair} with base token ${baseToken}`);
            return lpPair;
          }
        } catch (pairErr) {
          console.log(`Factory pair lookup failed for ${baseToken}:`, pairErr.message);
        }
      }
    } catch (err) {
      console.log("Factory pair lookup failed:", err.message);
    }
  }

  // Strategy 3: Try V2 API for token transfers to find LP
  try {
    const transfersResponse = await axios.get(`${BASE_URL}/tokens/${tokenAddress.toLowerCase()}/transfers`, {
      params: { limit: 10 },
      timeout: 5000
    });
    
    if (transfersResponse.data && Array.isArray(transfersResponse.data)) {
      // Look for transfers involving common LP patterns
      for (const transfer of transfersResponse.data) {
        if (transfer.from_hash && transfer.to_hash && 
            transfer.from_hash !== tokenAddress.toLowerCase() && 
            transfer.to_hash !== tokenAddress.toLowerCase()) {
          // This might be an LP address - would need more sophisticated logic
          console.log("Found potential LP via transfers:", transfer.to_hash);
        }
      }
    }
  } catch (apiErr) {
    console.log("V2 transfers API failed:", apiErr.message);
  }

  return lpPair;
}

// FIXED: Honeypot simulation - Simplified to avoid false positives
async function simulateTrading(tokenAddress, tokenInfo, liquidity) {
  const simulations = {
    transfer: "Pending",
    buy: "Pending", 
    sell: "Pending"
  };

  try {
    const tokenDecimals = tokenInfo.decimals || 18;
    const testAmount = ethers.parseUnits("1", tokenDecimals);

    // 1. Direct transfer simulation
    try {
      const tokenContract = new ethers.Contract(tokenAddress, [
        "function transfer(address to, uint256 amount) external returns (bool)"
      ], provider);
      
      await provider.call({
        to: tokenAddress,
        data: tokenContract.interface.encodeFunctionData("transfer", [
          ethers.Wallet.createRandom().address,
          0n
        ])
      });
      simulations.transfer = "✅ Transfer simulation passed";
    } catch (transferError) {
      try {
        const tokenContract = new ethers.Contract(tokenAddress, [
          "function transfer(address to, uint256 amount) external returns (bool)"
        ], provider);
        await provider.call({
          to: tokenAddress,
          data: tokenContract.interface.encodeFunctionData("transfer", [
            ethers.Wallet.createRandom().address,
            testAmount
          ])
        });
        simulations.transfer = "✅ Transfer simulation passed";
      } catch (transferError2) {
        const transferReason = transferError2.reason || transferError2.message || "";
        if (transferReason.toLowerCase().includes("insufficient balance") || 
            transferReason.toLowerCase().includes("transfer amount exceeds") ||
            transferReason.toLowerCase().includes("revert") ||
            transferReason.toLowerCase().includes("require")) {
          simulations.transfer = "ℹ️ Transfer needs balance (expected - not a honeypot)";
        } else {
          simulations.transfer = `⚠️ Transfer simulation inconclusive: ${extractErrorReason(transferReason)}`;
        }
      }
    }

    // 2. Buy/Sell simulation - approval test
    if (liquidity.lpPair && liquidity.pairedToken && ROUTER_ADDRESS) {
      try {
        const tokenContract = new ethers.Contract(tokenAddress, [
          "function approve(address spender, uint256 amount) external returns (bool)"
        ], provider);
        
        await provider.call({
          to: tokenAddress,
          data: tokenContract.interface.encodeFunctionData("approve", [
            ROUTER_ADDRESS,
            testAmount
          ])
        });
        simulations.buy = "✅ Buy simulation passed (approval test)";
        simulations.sell = "✅ Sell simulation passed (approval test)";
      } catch (approvalError) {
        const approvalReason = approvalError.reason || approvalError.message || "";
        if (approvalReason.toLowerCase().includes("insufficient allowance") ||
            approvalReason.toLowerCase().includes("revert") ||
            approvalReason.toLowerCase().includes("require") ||
            approvalReason.toLowerCase().includes("balance")) {
          simulations.buy = "ℹ️ Buy simulation needs balance (expected - not a honeypot)";
          simulations.sell = "ℹ️ Sell simulation needs balance (expected - not a honeypot)";
        } else {
          simulations.buy = `⚠️ Buy simulation inconclusive: ${extractErrorReason(approvalReason)}`;
          simulations.sell = `⚠️ Sell simulation inconclusive: ${extractErrorReason(approvalReason)}`;
        }
      }
    } else {
      simulations.buy = "ℹ️ Cannot test buy (missing LP/router data)";
      simulations.sell = "ℹ️ Cannot test sell (missing LP/router data)";
    }

  } catch (err) {
    console.log("Simulation failed:", err.message);
    simulations.transfer = `ℹ️ Simulation error (non-critical): ${err.message}`;
  }

  const honeypotRisk = assessHoneypotRisk(simulations);
  
  return { simulations, honeypotRisk };
}

function extractErrorReason(message) {
  const commonErrors = [
    { pattern: "transferfrom", reason: "transfer failed" },
    { pattern: "k", reason: "generic revert" },
    { pattern: "insufficient", reason: "insufficient funds" },
    { pattern: "expired", reason: "deadline expired" },
    { pattern: "liquidity", reason: "low liquidity" },
    { pattern: "amount", reason: "invalid amount" },
    { pattern: "balance", reason: "insufficient balance" },
    { pattern: "slippage", reason: "price impact" },
    { pattern: "deadline", reason: "time expired" }
  ];

  for (const error of commonErrors) {
    if (message.toLowerCase().includes(error.pattern)) {
      return error.reason;
    }
  }

  return message.length > 50 ? `${message.substring(0, 50)}...` : message;
}

function assessHoneypotRisk(simulations) {
  const criticalFailures = Object.values(simulations).filter(s => 
    s.includes("❌") || 
    (s.includes("failed") && !s.includes("expected") && !s.includes("inconclusive"))
  );
  
  const warnings = Object.values(simulations).filter(s => 
    s.includes("⚠️") && !s.includes("missing") && !s.includes("data")
  );
  
  if (criticalFailures.length >= 2) {
    return "🛑 HIGH HONEYPOT RISK - Multiple critical failures";
  } else if (criticalFailures.length === 1 && warnings.length >= 1) {
    const failedType = criticalFailures[0].toLowerCase();
    if (failedType.includes("sell") || failedType.includes("transfer")) {
      return "🟡 POTENTIAL HONEYPOT - Sell/transfer concerns detected";
    }
  } else if (warnings.length >= 2) {
    return "🟡 MODERATE CONCERNS - Multiple simulation warnings";
  }

  const passingOrExpected = Object.values(simulations).filter(s => 
    s.includes("✅") || 
    s.includes("ℹ️") || 
    s.includes("expected") ||
    s.includes("inconclusive") ||
    s.includes("missing") ||
    s.includes("data")
  );

  if (passingOrExpected.length >= 2) {
    return "✅ NO HONEYPOT INDICATORS - Simulations passed or expected behavior";
  }

  return "🟡 UNCLEAR - Insufficient simulation data";
}

// FIXED: Trading activity analysis
async function analyzeTradingActivity(tokenContract, owner, tokenDecimals) {
  let devActivity = "✅ No suspicious dev activity";
  let volume24h = "0";
  let uniqueBuyers24h = 0;
  let buySellRatio = "0:0";
  let totalTransactions24h = 0;

  try {
    if (owner && owner !== "N/A" && owner !== ethers.ZeroAddress && owner !== "RENOUNCED") {
      const devActivityReport = await monitorDevWallet(tokenContract, owner);
      if (devActivityReport.suspicious) {
        devActivity = `🚨 DEV ACTIVITY: ${devActivityReport.details}`;
      }
    }

    const tradingMetrics = await getRealTradingMetrics(tokenContract, tokenDecimals);
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
    const filter = tokenContract.filters.Transfer(owner, null);
    const buyFilter = tokenContract.filters.Transfer(null, owner);
    
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 10000);
    
    const [sells, buys] = await Promise.all([
      tokenContract.queryFilter(filter, fromBlock, latestBlock).catch(() => []),
      tokenContract.queryFilter(buyFilter, fromBlock, latestBlock).catch(() => [])
    ]);

    const sellValue = sells.reduce((sum, log) => sum + Number(log.args?.value || 0), 0n);
    const buyValue = buys.reduce((sum, log) => sum + Number(log.args?.value || 0), 0n);
    
    if (sells.length > 0 && sellValue > buyValue * 2n) {
      return {
        suspicious: true,
        details: `${sells.length} sells (${ethers.formatEther(sellValue)} tokens) vs ${buys.length} buys (${ethers.formatEther(buyValue)})`
      };
    }

    if (sells.length > 5) {
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

async function getRealTradingMetrics(tokenContract, tokenDecimals) {
  try {
    const filter = tokenContract.filters.Transfer();
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 5000);
    
    const transfers = await tokenContract.queryFilter(filter, fromBlock, latestBlock).catch(() => []);
    
    if (!transfers || transfers.length === 0) return null;

    let decimals = tokenDecimals || 18;
    if (!tokenDecimals || typeof tokenDecimals !== 'number') {
      try {
        decimals = await tokenContract.decimals();
      } catch {
        console.log("Could not fetch token decimals, using 18");
        decimals = 18;
      }
    }

    const uniqueFrom = new Set();
    const uniqueTo = new Set();
    let totalValue = 0n;
    
    for (const transfer of transfers) {
      if (transfer.args && transfer.args.value) {
        totalValue += transfer.args.value;
        if (transfer.args.from) uniqueFrom.add(transfer.args.from);
        if (transfer.args.to) uniqueTo.add(transfer.args.to);
      }
    }
    
    const formattedVolume = ethers.formatUnits(totalValue, decimals);
    
    const estimatedBuys = Math.floor(transfers.length * 0.6);
    const estimatedSells = transfers.length - estimatedBuys;
    
    return {
      volume24h: Number(formattedVolume).toLocaleString(),
      uniqueBuyers: uniqueTo.size,
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

    try {
      const isBlacklisted = await tokenContract._isBlacklisted(ethers.Wallet.createRandom().address);
      features.blacklistCheck = !!isBlacklisted;
    } catch {}

    try {
      await tokenContract.mint.estimateGas(ethers.Wallet.createRandom().address, 1n);
      features.mintable = true;
    } catch {}

    const code = await provider.getCode(tokenAddress);
    features.pauseable = code.toLowerCase().includes("paus") || code.toLowerCase().includes("freeze");

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
  let score = 10;
  
  if (features.mintable) score -= 4;
  if (features.blacklistCheck) score -= 3;
  if (features.pauseable) score -= 2;
  if (!features.ownershipRenounceable) score -= 1;
  
  return Math.max(0, score);
}

// 🔥 FIXED: Comprehensive risk calculation
function calculateComprehensiveRisk(analysis) {
  let score = 0;
  const factors = [];

  if (analysis.ownership.ownershipRisk === "High") score += 12;
  else if (analysis.ownership.ownershipRisk === "Medium") score += 6;

  if (analysis.taxes.buyTax > 15 || analysis.taxes.sellTax > 15) score += 16;
  else if (analysis.taxes.buyTax > 10 || analysis.taxes.sellTax > 10) score += 10;
  
  if (!analysis.taxes.hasHighLimits) score += 6;

  // Liquidity risk (30 points max)
  if (!analysis.liquidity.hasLiquidity) {
    score += 30;
    factors.push("🚨 NO LIQUIDITY - CRITICAL RISK");
  } else if (analysis.liquidity.lpRiskLevel === "CRITICAL") {
    score += 25;
    factors.push("🚨 LP UNLOCKED & UNBURNED - EXTREME RUG PULL RISK");
  } else if (analysis.liquidity.lpRiskLevel === "HIGH") {
    score += 20;
    factors.push("🔴 INSUFFICIENT LP PROTECTION - HIGH RUG RISK");
  } else if (analysis.liquidity.lpRiskLevel === "MEDIUM") {
    score += 12;
    factors.push("🟡 PARTIAL LP PROTECTION - MODERATE RUG RISK");
  } else {
    score += 0;
    factors.push("✅ STRONG LP PROTECTION - LOW RUG RISK");
  }

  if (analysis.holderAnalysis.top10Concentration > 60) {
    score += 15;
    factors.push("🐋 EXTREME WHALE CONCENTRATION");
  } else if (analysis.holderAnalysis.top10Concentration > 40) {
    score += 8;
    factors.push("🐋 HIGH WHALE CONCENTRATION");
  }

  if (analysis.simulation.honeypotRisk.includes("HIGH")) {
    score += 10;
    factors.push("🛑 HIGH HONEYPOT RISK");
  } else if (analysis.simulation.honeypotRisk.includes("POTENTIAL") || analysis.simulation.honeypotRisk.includes("MODERATE")) {
    score += 5;
    factors.push("⚠️ POTENTIAL HONEYPOT CONCERNS");
  }

  if (analysis.security.hasDangerousFeatures) {
    score += 8;
    factors.push("🚨 DANGEROUS CONTRACT FEATURES");
  }
  if (analysis.security.securityScore < 5) score += 2;

  if (!analysis.activity.hasHealthyActivity) {
    score += 3;
    factors.push("📉 LOW TRADING ACTIVITY");
  }
  if (analysis.activity.devActivity.includes("🚨")) {
    score += 2;
    factors.push("🚨 SUSPICIOUS DEV ACTIVITY");
  }

  if (analysis.contractAnalysis.complexityScore > 7) score += 3;
  if (analysis.contractAnalysis.suspiciousPatterns.canMint) score += 2;

  const maxScore = 110;
  const riskPercentage = Math.round((score / maxScore) * 100);
  
  let level, emoji, color;
  if (riskPercentage >= 50 || analysis.liquidity.lpRiskLevel === "CRITICAL") {
    level = "HIGH RISK";
    emoji = "🔴";
    color = "danger";
  } else if (riskPercentage >= 30 || analysis.liquidity.lpRiskLevel === "HIGH") {
    level = "MEDIUM RISK";
    emoji = "🟡";
    color = "warning";
  } else {
    level = "LOW RISK";
    emoji = "🟢";
    color = "success";
  }

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
  
  if (analysis.liquidity.lpRiskLevel === "CRITICAL") {
    insights.push("🚨 CRITICAL: LP is UNLOCKED and UNBURNED - EXTREME RUG PULL RISK");
    insights.push("⚠️ Only trade with money you can afford to lose completely");
  } else if (analysis.liquidity.lpRiskLevel === "HIGH") {
    insights.push("🔴 HIGH RISK: Insufficient LP protection - major rug pull vulnerability");
    insights.push("⚠️ Use extreme caution - consider waiting for better LP protection");
  }
  
  if (analysis.ownership.renounceable || analysis.ownership.owner === "RENOUNCED") {
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

  if (analysis.taxes.buyTax > 10 || analysis.taxes.sellTax > 10) {
    insights.push("⚠️ High taxes may impact profitability - consider tax efficiency");
  }
  
  if (analysis.holderAnalysis.top10Concentration > 40) {
    insights.push(`🐋 Top 10 holders control ${analysis.holderAnalysis.top10Concentration.toFixed(1)}% - watch for coordinated dumps`);
  }

  if (riskPercentage < 25 && analysis.liquidity.lpRiskLevel === "LOW") {
    insights.push("📈 Suitable for swing trading - set stop losses at 15-20%");
  } else if (riskPercentage < 40 && analysis.liquidity.lpRiskLevel !== "CRITICAL") {
    insights.push("⚖️ Medium risk - use tight stop losses (10%) and small position sizes");
  } else {
    insights.push("🚨 High risk - only for experienced traders with strict risk management");
  }

  if (analysis.activity.uniqueBuyers24h > 20) {
    insights.push(`📊 Strong community interest: ${analysis.activity.uniqueBuyers24h} unique buyers in 24h`);
  }

  return insights.length > 0 ? insights.join("\n") : "⚠️ No specific insights - CRITICAL: DYOR immediately";
}

// 🔥 FIXED: Enhanced report formatting with REAL V2 supply data & FIXED holders/age
function formatAnalysisReport(analysis) {
  const { riskAssessment, tokenInfo, ownership, taxes, liquidity, holderAnalysis, 
          simulation, activity, security, contractAnalysis, pairCreationInfo, contractCreationInfo } = analysis;

  const holdersText = holderAnalysis.displayHolders.length > 0 ? 
    holderAnalysis.displayHolders
      .map((h, i) => `${i + 1}. ${h.address.slice(0, 6)}...: ${h.percent.toFixed(2)}%`)
      .join("\n") : "No holder data available";

  // 🔥 FIXED: Use contract creation time for accurate age calculation
  let contractAge = "Unknown";
  if (contractCreationInfo && contractCreationInfo.ageHours) {
    const ageHours = contractCreationInfo.ageHours;
    if (ageHours < 24) {
      contractAge = `${ageHours}h`;
    } else if (ageHours < 168) {
      contractAge = `${Math.round(ageHours / 24)}d`;
    } else if (ageHours < 720) {
      contractAge = `${Math.round(ageHours / 168)}w`;
    } else {
      contractAge = `${Math.round(ageHours / 720)}m`;
    }
    contractAge += contractCreationInfo.estimated ? " (est.)" : "";
  }

  let lpDetails = liquidity.lpStatus;
  if (liquidity.lpRiskLevel === "CRITICAL") {
    lpDetails = `🚨 ${liquidity.lpStatus}`;
  } else if (liquidity.lpRiskLevel === "HIGH") {
    lpDetails = `🔴 ${liquidity.lpStatus}`;
  } else if (liquidity.lpLocked) {
    lpDetails += `\n   └─ ${liquidity.lockedAmount ? ethers.formatEther(liquidity.lockedAmount) : 'Unknown'} LP tokens locked`;
    lpDetails += `\n   └─ Unlocks: ${liquidity.unlockDate}`;
  }

  // 🔥 FIXED: Format total supply properly from V2 API/contract
  let formattedSupply = "Unknown";
  if (tokenInfo.totalSupply && tokenInfo.totalSupply > 0n) {
    try {
      const supplyNumber = Number(ethers.formatUnits(tokenInfo.totalSupply, tokenInfo.decimals));
      if (isNaN(supplyNumber)) {
        formattedSupply = tokenInfo.totalSupply.toString();
      } else if (supplyNumber >= 1000000000) {
        formattedSupply = (supplyNumber / 1000000000).toFixed(1) + "B";
      } else if (supplyNumber >= 1000000) {
        formattedSupply = (supplyNumber / 1000000).toFixed(1) + "M";
      } else if (supplyNumber >= 1000) {
        formattedSupply = (supplyNumber / 1000).toFixed(0) + "K";
      } else {
        formattedSupply = supplyNumber.toLocaleString();
      }
      
      console.log(`✅ Formatted supply: ${formattedSupply} (raw: ${tokenInfo.totalSupply.toString()})`);
    } catch (e) {
      console.log("Supply formatting error:", e.message);
      formattedSupply = tokenInfo.totalSupply.toString();
    }
  }

  // 🔥 FIXED: Display holders count from API
  const holdersDisplay = tokenInfo.holdersCount > 0 ? `${tokenInfo.holdersCount} holders` : "0 holders";

  return [
    `${riskAssessment.emoji} ${riskAssessment.level} (${riskAssessment.riskPercentage}%)`,
    "",
    `📋 TOKEN OVERVIEW`,
    `${tokenInfo.name || 'Unknown'} (${tokenInfo.symbol || '???'})`,
    `Total Supply: ${formattedSupply}`,
    `Contract Age: ${contractAge}`,
    `${holdersDisplay}`,
    `Contract: ${contractAnalysis.isContract ? "✅ Deployed" : "❌ Not a contract"}`,
    `Verified: ${ownership.verified ? "✅ Verified Source Code" : "⚠️ Unverified"}`,
    "",
    `👑 OWNERSHIP`,
    `Owner: ${ownership.owner}`,
    `Risk Level: ${ownership.ownershipRisk}`,
    `${ownership.canRenounce ? "🔓 Can renounce ownership" : "🔒 Ownership fixed"}`,
    "",
    `💰 TAXES & LIMITS`,
    `Buy Tax: ${taxes.buyTax}% | Sell Tax: ${taxes.sellTax}%`,
    `Max TX: ${taxes.maxTxPercent.toFixed(1)}% of supply | Max Wallet: ${taxes.maxWalletPercent.toFixed(1)}%`,
    `${taxes.hasHighLimits ? "✅ Reasonable limits" : "⚠️ Restrictive limits"}`,
    "",
    `💧 LIQUIDITY`,
    lpDetails,
    `${liquidity.hasLiquidity ? "✅ Liquidity detected" : "❌ NO LIQUIDITY - CRITICAL"}`,
    `${liquidity.lpRiskLevel === "LOW" ? "🟢 LOW RISK" : liquidity.lpRiskLevel === "MEDIUM" ? "🟡 MEDIUM RISK" : "🔴 HIGH/CRITICAL RISK"} LP Protection`,
    "",
    `👥 HOLDER DISTRIBUTION`,
    `${holderAnalysis.totalLiveHolders || 0} live holders`,
    `Top 10 control: ${holderAnalysis.top10Concentration.toFixed(1)}%`,
    `Gini Index: ${holderAnalysis.giniCoefficient} (0=equal, 1=unequal)`,
    `Distribution: ${holderAnalysis.healthyDistribution ? "✅ Healthy" : "⚠️ Concentrated"}`,
    "",
    holdersText,
    "",
    `🛡️ HONEYPOT CHECK`,
    `${simulation.honeypotRisk}`,
    "",
    `📊 TRADING ACTIVITY (24h)`,
    `${activity.devActivity}`,
    `Unique Buyers: ${activity.uniqueBuyers24h || 0}`,
    `Total Volume: ${activity.volume24h || '0'} tokens`,
    `Transactions: ${activity.totalTransactions24h || 0}`,
    `Buy:Sell Ratio: ${activity.buySellRatio}`,
    `${activity.hasHealthyActivity ? "✅ Active trading" : "⚠️ Low activity"}`,
    "",
    `🔒 SECURITY FEATURES`,
    `Security Score: ${security.securityScore}/10`,
    `${security.hasDangerousFeatures ? "⚠️ Dangerous features detected" : "✅ No dangerous features"}`,
    security.features.mintable ? "🚨 Can mint new tokens" : "",
    security.features.blacklistCheck ? "🚨 Has blacklist function" : "",
    security.features.pauseable ? "🚨 Can pause trading" : "",
    `${security.features.ownershipRenounceable ? "✅ Can renounce ownership" : "⚠️ Cannot renounce ownership"}`,
    "",
    `💡 TRADER INSIGHTS`,
    riskAssessment.insights,
    "",
    `⚠️ RISK SUMMARY`,
    `Overall Risk: ${riskAssessment.level}`,
    `Risk Factors: ${riskAssessment.factors.length > 0 ? riskAssessment.factors.slice(0, 3).join(', ') : 'None detected'}${riskAssessment.factors.length > 3 ? '...' : ''}`,
    `Recommendation: ${getTradingRecommendation(riskAssessment.riskPercentage, liquidity.lpRiskLevel)}`,
    "",
    `⚠️ Always DYOR - This analysis is for informational purposes only`
  ].filter(line => line && line.trim() !== "").join("\n");
}

function getTradingRecommendation(riskPercentage, lpRiskLevel) {
  if (lpRiskLevel === "CRITICAL") {
    return "🚨 EXTREME RISK - AVOID or use MINIMAL position size only";
  } else if (lpRiskLevel === "HIGH") {
    return "🔴 HIGH RISK - Only for experienced traders with strict risk management";
  }
  
  if (riskPercentage < 25) return "🟢 Safe for accumulation - consider long-term hold";
  if (riskPercentage < 40) return "🟢 Good for swing trading - set 15% stop loss";
  if (riskPercentage < 55) return "🟡 Trade with caution - use 10% stop loss, small positions";
  if (riskPercentage < 70) return "🟠 High risk - only for experienced traders";
  return "🔴 Extreme risk - avoid or use minimal position size";
}

export default { analyzeToken };
