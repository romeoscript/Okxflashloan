import {  
  PublicKey, 
  TransactionInstruction,
  TransactionMessage,        
  VersionedTransaction,      
  AddressLookupTableAccount,
  Transaction,
  ComputeBudgetProgram,
  SystemProgram,
  LAMPORTS_PER_SOL      
} from "@solana/web3.js";

import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createCloseAccountInstruction
} from "@solana/spl-token";

import BN from "bn.js";

import {
  flashBorrowReserveLiquidityInstruction,
  flashRepayReserveLiquidityInstruction,  
} from "@solendprotocol/solend-sdk";

import { WSOL_MINT_KEY, RESERVE_ADDRESS, LENDING_MARKET, LENDING_PROGRAM_ID, SUPPLYPUBKEY, FEE_RECEIVER_ADDRESS} from "./const";
import { Connection } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";

// Jupiter API types
interface JupiterQuoteResponse {
inputMint: string;
inAmount: string;
outputMint: string;
outAmount: string;
otherAmountThreshold: string;
swapMode: string;
slippageBps: number;
platformFee?: any;
priceImpactPct: string;
routePlan: any[];
}

interface JupiterSwapResponse {
swapTransaction: string;
lastValidBlockHeight: number;
prioritizationFeeLamports: number;
}

// Jupiter API base URL
const JUPITER_API_BASE = "https://quote-api.jup.ag/v6";

async function getJupiterQuote({
  inputMint,
  outputMint,
  amount,
  slippageBps = 100,
  cluster = 'mainnet-beta',
  onlyDirectRoutes = false
}: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  cluster?: string;
  onlyDirectRoutes?: boolean;
}): Promise<JupiterQuoteResponse> {
  const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount,
      slippageBps: slippageBps.toString(),
      onlyDirectRoutes: 'true', // Force direct routes
      asLegacyTransaction: 'true', // Force legacy transaction format
      cluster
  });

  console.log(`\n🌐 Requesting Jupiter quote with parameters:`);
  console.log(`  Input: ${inputMint}`);
  console.log(`  Output: ${outputMint}`);
  console.log(`  Amount: ${amount}`);
  console.log(`  Direct Routes Only: true`);
  console.log(`  Legacy Transaction: true`);

  const response = await fetch(`${JUPITER_API_BASE}/quote?${params}`);
  
  if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jupiter quote failed: ${response.statusText}. Details: ${errorText}`);
  }
  
  const quote = await response.json();
  
  // Validate that we got a direct route
  if (quote.routePlan.length > 1) {
      throw new Error('Jupiter returned a multi-hop route despite requesting direct routes only');
  }

  console.log(`\n✅ Got quote:`);
  console.log(`📥 Input: ${quote.inAmount} (${inputMint})`);
  console.log(`📤 Output: ${quote.outAmount} (${outputMint})`);
  console.log(`📊 Price Impact: ${quote.priceImpactPct}%`);
  console.log(`🛣️  Route: ${quote.routePlan.length} steps`);
  
  return quote;
}

async function getJupiterSwapTransaction({
  quote,
  userPublicKey,
  priorityLevelWithMaxLamports = 'medium',
  cluster = 'mainnet-beta',
  useSharedAccounts = true
}: {
  quote: JupiterQuoteResponse;
  userPublicKey: string;
  priorityLevelWithMaxLamports?: string;
  cluster?: string;
  useSharedAccounts?: boolean;
}): Promise<JupiterSwapResponse> {
  const response = await fetch(`${JUPITER_API_BASE}/swap`, {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json',
      },
      body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey,
          wrapAndUnwrapSol: true,
          priorityLevelWithMaxLamports,
          asLegacyTransaction: true, // Force legacy transaction format
          useSharedAccounts: false, // Disable shared accounts
          dynamicComputeUnitLimit: true,
          skipUserAccountsRpcCalls: false,
          cluster
      }),
  });

  if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jupiter swap failed: ${response.statusText}. Details: ${errorText}`);
  }

  return response.json();
}

async function estimateWSOLForTokenSwap({
  targetToken,
  slippageBps,
  desiredTargetAmount
}: {
  targetToken: PublicKey;
  slippageBps: number;
  desiredTargetAmount: string;
}) {
  // First, get a quote for 1 SOL to the target token to understand the rate
  const oneSOLAmount = "1000000000"; // 1 SOL in lamports
  
  const quote = await getJupiterQuote({
      inputMint: WSOL_MINT_KEY.toString(),
      outputMint: targetToken.toString(),
      amount: oneSOLAmount,
      slippageBps
  });

  // Calculate the rate: how many target tokens per 1 SOL
  const tokensPerSOL = parseFloat(quote.outAmount);
  
  // Calculate how much SOL we need for the desired target amount
  const requiredSOL = parseFloat(desiredTargetAmount) / tokensPerSOL;
  
  // Convert to lamports
  const wsolInLamports = Math.floor(requiredSOL * 1e9);

  return {
      wsolAmount: requiredSOL,
      wsolInLamports: wsolInLamports.toString(),
      rate: tokensPerSOL,
      quote
  };
}

async function createFlashLoanIx({
  tokenAccount,
  targetToken, 
  wsolAmount,
  connection, 
  wallet
}: {
  tokenAccount: PublicKey;
  targetToken: PublicKey;
  wsolAmount: string;
  connection: Connection;
  wallet: Wallet;
}) {
  const instructions: TransactionInstruction[] = [];

  // Create WSOL account
  instructions.push(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenAccount,
      wallet.publicKey,
      NATIVE_MINT
    )
  );

  // Transfer SOL to WSOL account
  instructions.push(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: tokenAccount,
      lamports: BigInt(wsolAmount)
    })
  );

  // Sync WSOL balance
  instructions.push(
    createSyncNativeInstruction(tokenAccount)
  );

  // Add flash borrow instruction
  instructions.push(
    flashBorrowReserveLiquidityInstruction(
      new BN(wsolAmount),
      SUPPLYPUBKEY,
      tokenAccount,
      RESERVE_ADDRESS,
      LENDING_MARKET,
      LENDING_PROGRAM_ID
    )
  );
  
  return instructions;
}

// Helper function to validate repayment funds
async function validateRepaymentFunds(
  tokenAccount: PublicKey, 
  repaymentAmount: string, 
  connection: Connection
): Promise<void> {
  try {
    const accountInfo = await connection.getTokenAccountBalance(tokenAccount);
    const balance = accountInfo.value.amount;
    
    console.log(`🏦 WSOL account balance: ${balance}`);
    console.log(`💳 Required repayment: ${repaymentAmount}`);
    
    if (new BN(balance).lt(new BN(repaymentAmount))) {
      throw new Error(`Insufficient WSOL balance for repayment. Have: ${balance}, Need: ${repaymentAmount}`);
    }
    
    console.log(`✅ Sufficient balance for repayment`);
  } catch (error) {
    console.warn(`⚠️ Could not validate balance:`, error);
    // Continue anyway - account might not exist yet during simulation
  }
}

async function getSwapInstructionsFromJupiter({
  inputMint,
  outputMint,
  amount,
  slippageBps,
  userPublicKey,
  connection,
  cluster = 'mainnet-beta'
}: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  userPublicKey: string;
  connection: Connection;
  cluster?: string;
}) {
  try {
    // Get quote from Jupiter with direct routes only and legacy transaction format
    const quote = await getJupiterQuote({
        inputMint,
        outputMint,
        amount,
        slippageBps,
        cluster,
        onlyDirectRoutes: true
    });

    // Get swap transaction data with legacy format
    const swapResponse = await getJupiterSwapTransaction({
        quote,
        userPublicKey,
        cluster,
        useSharedAccounts: false
    });

    // Parse the transaction as legacy format
    const swapTransactionBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
    const transaction = Transaction.from(swapTransactionBuf);
    
    // Get instructions from the transaction
    let instructions = [...transaction.instructions];

    // Remove any existing compute budget instructions
    instructions = instructions.filter(ix => 
      !ix.programId.equals(ComputeBudgetProgram.programId)
    );

    // **CRITICAL FIX: Remove close account instructions from Jupiter swap**
    // These will interfere with our flash loan repayment
    instructions = instructions.filter(ix => {
      // Check if it's a close account instruction (instruction index 9 in Token program)
      if (ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data[0] === 9) {
        console.log(`🔧 Removed close account instruction from Jupiter swap`);
        return false;
      }
      return true;
    });

    // Log instruction details for debugging
    console.log(`\n📝 Swap transaction instructions (after filtering):`);
    instructions.forEach((ix, index) => {
        console.log(`\nInstruction ${index}:`);
        console.log(`  Program ID: ${ix.programId.toString()}`);
        console.log(`  Accounts: ${ix.keys.map(k => k.pubkey.toString()).join(', ')}`);
    });

    return {
        instructions,
        lookupTableAccounts: [] as AddressLookupTableAccount[],
        quote
    };
  } catch (error) {
    console.error('Error in getSwapInstructionsFromJupiter:', error);
    throw error;
  }
}

export async function buildSimulatedFlashLoanInstructions({
  targetTokenMint,
  desiredTargetAmount,
  slippageBps = 100,
  userInstructions = [],
  connection,
  wallet
}: {
  targetTokenMint: PublicKey,
  desiredTargetAmount: string,
  slippageBps?: number,
  userInstructions?: TransactionInstruction[] | (() => Promise<TransactionInstruction[]>),
  connection: Connection,
  wallet: Wallet
}) {
  try {
    // Determine cluster from connection endpoint
    const cluster = connection.rpcEndpoint.includes('devnet') ? 'devnet' : 'mainnet-beta';
    
    if (cluster === 'devnet') {
        console.log(`\n⚠️ Running on devnet - some features may be limited:`);
        console.log(`1. Limited token pairs available`);
        console.log(`2. Lower liquidity`);
        console.log(`3. Some routes may not be supported`);
        console.log(`\n💡 For testing flash loan logic, consider:`);
        console.log(`- Using a smaller amount`);
        console.log(`- Using a different token pair`);
        console.log(`- Testing on mainnet for full functionality`);
    }
    
    console.log(`\n🌐 Using Jupiter cluster: ${cluster}`);
    
    // (1) Estimate how much WSOL is needed to get `desiredTargetAmount` of targetToken
    const { wsolAmount, wsolInLamports, rate } = 
        await estimateWSOLForTokenSwap({
            targetToken: targetTokenMint, 
            slippageBps: slippageBps, 
            desiredTargetAmount: desiredTargetAmount
        });

    const tokenAccount = await getAssociatedTokenAddress(
        WSOL_MINT_KEY,
        wallet.publicKey,
        false // allowOwnerOffCurve = false
    );

    // (2) Create Flash Loan instruction for `wsolInAmount` of WSOL
    const flashLoanIxs = await createFlashLoanIx({
        tokenAccount: tokenAccount,
        targetToken: WSOL_MINT_KEY,
        wsolAmount: wsolInLamports,
        connection: connection, 
        wallet
    });

    // (3) Get swap instructions from Jupiter (now with close instructions removed)
    const { instructions: swapInstructions, lookupTableAccounts, quote } = 
        await getSwapInstructionsFromJupiter({
            inputMint: WSOL_MINT_KEY.toString(),
            outputMint: targetTokenMint.toString(),
            amount: wsolInLamports,
            slippageBps,
            userPublicKey: wallet.publicKey.toString(),
            connection,
            cluster
        });

    // (4) User-defined logic
    const resolvedUserInstructions =
        typeof userInstructions === "function"
            ? await userInstructions()
            : userInstructions;    
    
    // Calculate the correct instruction index for flash repay
    const BORROW_INSTRUCTION_INDEX = 3; // 0-based index of the borrow instruction

    console.log(`💰 Borrowing and repaying: ${wsolInLamports} lamports`);
    console.log(`💡 Solend handles fees internally - no manual fee calculation needed`);

    // **CRITICAL FIX: Repay exactly what was borrowed - Solend handles fees internally**
    // Do NOT add fees manually, Solend calculates them automatically
    const repay = flashRepayReserveLiquidityInstruction(
      new BN(wsolInLamports), // Use exact borrowed amount, NOT with added fees
      BORROW_INSTRUCTION_INDEX,
      tokenAccount,
      SUPPLYPUBKEY,
      FEE_RECEIVER_ADDRESS,
      tokenAccount,
      RESERVE_ADDRESS,
      LENDING_MARKET,
      wallet.publicKey,
      LENDING_PROGRAM_ID
    );

    // Create instructions to close WSOL account and return SOL
    // **CRITICAL: Only close at the very end, after repayment**
    const closeWSOLAccount = createCloseAccountInstruction(
      tokenAccount,
      wallet.publicKey,
      wallet.publicKey
    );

    // Create compute budget instructions
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 2_000_000
    });
    const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1000
    });

    // **CRITICAL FIX: Proper instruction ordering**
    const allInstructions = [
      // 1. Setup and borrow (creates WSOL account and borrows funds)
      ...flashLoanIxs,        // Instructions 0-3: Create account, transfer SOL, sync, borrow
      
      // 2. Compute budget (set once)
      computeBudgetIx,        // Instruction 4
      priorityFeeIx,          // Instruction 5
      
      // 3. Execute swap and user logic (WSOL account must stay open!)
      ...swapInstructions,    // Instructions 6+: Do the swap (close instructions removed!)
      ...resolvedUserInstructions, // Any user instructions
      
      // 4. Repay flash loan (requires WSOL account to still exist)
      repay,                  // Repay the flash loan with borrowed funds + fee
      
      // 5. Cleanup (only after everything is complete)
      closeWSOLAccount        // Close WSOL account and return leftover SOL
    ];

    // Log instruction details for debugging
    console.log(`\n📝 Transaction instructions in correct order:`);
    allInstructions.forEach((ix, index) => {
      console.log(`\nInstruction ${index}:`);
      console.log(`  Program ID: ${ix.programId.toString()}`);
      if (ix.programId.equals(ComputeBudgetProgram.programId)) {
        console.log(`  Compute Budget Instruction (${index === 4 ? 'Set Limit' : 'Set Priority Fee'})`);
      } else if (ix.programId.equals(LENDING_PROGRAM_ID)) {
        console.log(`  Solend ${index === BORROW_INSTRUCTION_INDEX ? 'Borrow' : 'Repay'} Instruction`);
      if (index !== BORROW_INSTRUCTION_INDEX) {
        console.log(`    Note: Repaying exact borrowed amount - Solend handles fees internally`);
      }
      } else if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
        if (ix.data[0] === 9) { // CloseAccount instruction
          console.log(`  Close Account Instruction (WSOL cleanup) - ONLY AT THE END`);
        } else {
          console.log(`  Token Program Instruction`);
        }
      } else {
        console.log(`  Other instruction`);
      }
    });

    const latestBlockhash = await connection.getLatestBlockhash('finalized');

    // Load lookup table accounts if any
    console.log(`\n📋 Loading lookup tables...`);
    if (lookupTableAccounts.length > 0) {
        console.log(`Found ${lookupTableAccounts.length} lookup tables in the route`);
    }
    
    // Validate all account keys before compilation
    const allAccountKeys = new Set<PublicKey>();
    allInstructions.forEach(ix => {
      allAccountKeys.add(ix.programId);
      ix.keys.forEach(key => allAccountKeys.add(key.pubkey));
    });

    // Validate lookup table accounts
    const validLookupTables = lookupTableAccounts.filter((table): table is AddressLookupTableAccount => {
        if (!table || !('state' in table) || !table.state || !('addresses' in table.state)) {
            console.warn(`⚠️ Invalid lookup table structure`);
            return false;
        }
        return true;
    });

    // Only throw if we have lookup tables but none are valid
    if (lookupTableAccounts.length > 0 && validLookupTables.length === 0) {
      throw new Error('No valid lookup tables available for transaction compilation');
    }

    console.log(`\n📝 Compiling transaction message...`);
    
    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: allInstructions
    }).compileToV0Message(validLookupTables.length > 0 ? validLookupTables : undefined);

    return {
      transaction: new VersionedTransaction(messageV0),
      quote,
      estimatedOutput: quote.outAmount,
      priceImpact: quote.priceImpactPct,
      route: quote.routePlan,
      market: LENDING_MARKET,
      solReserve: RESERVE_ADDRESS,
      borrowedAmount: wsolInLamports, // The exact amount borrowed (and repaid)
      addresses: {
        RESERVE_ADDRESS,
        LENDING_MARKET,
        LENDING_PROGRAM_ID,
        SUPPLYPUBKEY,
        FEE_RECEIVER_ADDRESS,
        wsolAccount: tokenAccount
      }
    };
  } catch (error) {
    console.error('Error in buildSimulatedFlashLoanInstructions:', error);
    if (error instanceof Error) {
      console.log(`💡 Full error details:`, error);
    }
    throw error;
  }
}