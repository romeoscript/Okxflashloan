import {  
    PublicKey, 
    TransactionInstruction,
    TransactionMessage,        
    VersionedTransaction,      
  } from "@solana/web3.js";

  import {
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction
  } from "@solana/spl-token";

import { OKXDexClient } from '@okx-dex/okx-dex-sdk';
import crypto from "crypto";
import BN from "bn.js";



import {
    flashBorrowReserveLiquidityInstruction,
    flashRepayReserveLiquidityInstruction,  
} from "@solendprotocol/solend-sdk";

import { OKX_API_KEY, OKX_API_PASSPHRASE, OKX_API_SECRET, OKX_PROJECT_ID, WSOL_MINT_KEY, RESERVE_ADDRESS, LENDING_MARKET, LENDING_PROGRAM_ID, SUPPLYPUBKEY, FEE_RECEIVER_ADDRESS} from "./const";
import { Connection } from "@solana/web3.js";
import { Wallet } from "@okx-dex/okx-dex-sdk/dist/core/wallet";




function getHeaders(timestamp: string, method: string, requestPath: string, queryString: string = "") {
    const prehash = timestamp + method + requestPath + queryString;
    const hmac = crypto.createHmac("sha256", OKX_API_SECRET);
    const signature = hmac.update(prehash).digest("base64");
  
    return {
      "OK-ACCESS-KEY": OKX_API_KEY,
      "OK-ACCESS-SIGN": signature,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": OKX_API_PASSPHRASE,
      "Content-Type": "application/json",
    };
  }


async function estimateWSOLForTokenSwap({
    okxclient,
    targetToken,
    slippage,
    desiredTargetAmount
}) {
    // Get quote for 1 WSOL to USD
    const quote = await okxclient.dex.getQuote({
        chainId: '501',
        fromTokenAddress: WSOL_MINT_KEY.toString(),
        toTokenAddress: targetToken?.toString(),
        amount: '1000000000000', // 1 WSOL
        slippage: slippage,
        dexIds: '277',
        directRoute: true,
        feePercent: '1'
    });

    // Get the rate (how many USD per 1 WSOL)
    const usdPerWSOL = quote?.data[0].toTokenAmount;
    
    // Calculate how many WSOL we need for the desired USD amount
    // Formula: usdAmount / usdPerWSOL
    const wsolAmount = (desiredTargetAmount * 1000) / usdPerWSOL;
    
    // Convert to lamports (multiply by 1e9)
    const wsolInLamports = Math.floor(wsolAmount * 1e9);

    return {
        wsolAmount,
        wsolInLamports: wsolInLamports.toString(),
        rate: usdPerWSOL // USD per 1 WSOL
    };
}

async function createFlashLoanIx({
    tokenAccount,
    targetToken, 
    wsolAmount,
    connection, 
    wallet
}) {
    const accountInfo = await connection.getAccountInfo(tokenAccount);

    const instructions: TransactionInstruction[] = [];

    if (!accountInfo) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            tokenAccount,
            wallet.publicKey,
            targetToken
          )
        );
    }

    instructions.push(
        flashBorrowReserveLiquidityInstruction(
          wsolAmount,
          SUPPLYPUBKEY,
          tokenAccount,
          RESERVE_ADDRESS,
          LENDING_MARKET,
          LENDING_PROGRAM_ID
        )
    );
    
    return instructions
}


function createTransactionInstruction(instruction: any) {
    return new TransactionInstruction({
      programId: new PublicKey(instruction.programId),
      keys: instruction.accounts.map((key: any) => ({
        pubkey: new PublicKey(key.pubkey),
        isSigner: key.isSigner,
        isWritable: key.isWritable,
      })),
      data: Buffer.from(instruction.data, "base64"),
    });
  }

      // 📡 Fetch instructions from OKX DEX
async function fetchSwapInstructions(params, connection) {
    const timestamp = new Date().toISOString();
    const requestPath = "/api/v5/dex/aggregator/swap-instruction";
    const queryString = "?" + new URLSearchParams(params).toString();
    const headers = getHeaders(timestamp, "GET", requestPath, queryString);
  
    const response = await fetch(`https://web3.okx.com${requestPath}${queryString}`, {
      method: "GET",
      headers,
    });
  
    const json = await response.json() as { data: any }; // 👈 tells TS what `json` is
    const { instructionLists, addressLookupTableAccount } = json.data;
  
    const instructions = instructionLists.map(createTransactionInstruction);
    const uniqueLookupTables = Array.from(new Set(addressLookupTableAccount));
  
    // Load lookup tables
    const lookupTableAccounts = await Promise.all(
        (uniqueLookupTables as string[]).map(async (address) => {
          const pubkey = new PublicKey(address);
          const account = await connection.getAddressLookupTable(pubkey).then((res) => res.value);
          if (!account) {
            throw new Error(`Could not fetch lookup table account ${address}`);
          }
          return account;
        })
      );
    return { instructions, lookupTableAccounts };
  }




  
export async function buildSimulatedFlashLoanInstructions({
    targetTokenMint,
    desiredTargetAmount,
    slippage = '0.1',
    userInstructions = [],
    connection,
    wallet
  }: {
    targetTokenMint: PublicKey,
    desiredTargetAmount: string,
    slippage?: string,
    userInstructions?: TransactionInstruction[] | (() => Promise<TransactionInstruction[]>),
    connection: Connection,
    wallet: Wallet
  }) {
    const client = new OKXDexClient({
        apiKey: OKX_API_KEY!,
        secretKey: OKX_API_SECRET!,
        apiPassphrase: OKX_API_PASSPHRASE!,
        projectId: OKX_PROJECT_ID!,
        solana: {
            wallet: wallet,
            computeUnits: 300000,
            maxRetries: 3
        }
    });
    
    // (1) Estimate how much WSOL is needed to get `desiredTargetAmount` of targetToken
    const { wsolAmount, wsolInLamports, rate } = 
    await estimateWSOLForTokenSwap({okxclient: client, targetToken: targetTokenMint, slippage: slippage, desiredTargetAmount: desiredTargetAmount})

    // 🌉 Define swap parameters
    const params = {
        chainId: "501", // Solana
        feePercent: "1",
        amount: wsolInLamports, // in lamports (0.001 SOL)
        fromTokenAddress: "So11111111111111111111111111111111111111112", // SOL
        toTokenAddress: targetTokenMint.toString(), // USDC
        slippage: slippage,
        userWalletAddress: wallet.publicKey.toString(),
        priceTolerance: "0",
        autoSlippage: "false",
        pathNum: "3",
    };
        
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

    const {instructions, lookupTableAccounts} = await fetchSwapInstructions(params, connection)


    // (4) User-defined logic
    const resolvedUserInstructions =
    typeof userInstructions === "function"
        ? await userInstructions()
        : userInstructions;    
    
    const repay = flashRepayReserveLiquidityInstruction(
        new BN(wsolInLamports),
        1,                           // Borrow instruction index
        tokenAccount,                // Source liquidity (your token account)
        SUPPLYPUBKEY,           // Destination liquidity (reserve's SPL token account)
        FEE_RECEIVER_ADDRESS,        // Correct reserve liquidity fee receiver
        tokenAccount,                // Host fee receiver (can be set as token account if unused)
        RESERVE_ADDRESS,
        LENDING_MARKET,
        wallet.publicKey,
        LENDING_PROGRAM_ID
    )

    const allInstructions = [
        ...flashLoanIxs,
        ...instructions,
        ...resolvedUserInstructions,
        repay
    ]

    const latestBlockhash = await connection.getLatestBlockhash('finalized');

    const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: allInstructions
      }).compileToV0Message(lookupTableAccounts);

    return new VersionedTransaction(messageV0);
  }


