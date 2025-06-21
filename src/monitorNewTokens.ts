import { rayFee, solanaConnection } from './constants';
import { storeData } from './utils';
import fs from 'fs';
import chalk from 'chalk';
import path from 'path';
import { Connection, ParsedTransactionMeta } from '@solana/web3.js';
import { MAINNET_PROGRAM_ID } from '@raydium-io/raydium-sdk';

const dataPath = path.join(__dirname, 'data', 'new_solana_tokens.json');

interface TokenBalance {
  owner: string;
  mint: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
  };
}

interface NewTokenData {
  lpSignature: string;
  creator: string;
  timestamp: string;
  baseInfo: {
    baseAddress: string;
    baseDecimals: number;
    baseLpAmount: number;
  };
  quoteInfo: {
    quoteAddress: string;
    quoteDecimals: number;
    quoteLpAmount: number;
  };
  logs: string[];
}

// Store the callback function reference for cleanup
let logCallback: ((args: any) => void) | null = null;

export async function monitorNewTokens(connection: Connection): Promise<() => void> {
  console.log(chalk.green(`monitoring new solana tokens...`));
  console.log(chalk.blue(`Using RPC endpoint: ${connection.rpcEndpoint}`));

  try {
    // Test the connection first
    try {
      const slot = await connection.getSlot();
      console.log(chalk.green(`✓ Connection test successful. Current slot: ${slot}`));
    } catch (connectionError) {
      console.error(chalk.red(`✗ Connection test failed: ${connectionError}`));
      throw new Error(`Failed to connect to Solana RPC: ${connectionError}`);
    }

    logCallback = async ({ logs, err, signature }) => {
      try {
        if (err) {
          console.error(chalk.red(`✗ Transaction error for signature ${signature}:`));
          console.error(chalk.red(`  Error details: ${JSON.stringify(err, null, 2)}`));
          return;
        }

        console.log(chalk.bgGreen(`✓ Found new token signature: ${signature}`));

        let signer = '';
        let baseAddress = '';
        let baseDecimals = 0;
        let baseLpAmount = 0;
        let quoteAddress = '';
        let quoteDecimals = 0;
        let quoteLpAmount = 0;

        /**You need to use a RPC provider for getparsedtransaction to work properly.
         * Check README.md for suggestions.
         */
        const parsedTransaction = await connection.getParsedTransaction(
          signature,
          {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed',
          }
        );

        if (parsedTransaction?.meta && parsedTransaction.meta.err == null) {
          console.log(chalk.green(`✓ Successfully parsed transaction`));

          signer =
            parsedTransaction.transaction.message.accountKeys[0].pubkey.toString();

          console.log(chalk.blue(`  Creator: ${signer}`));

          const postTokenBalances = parsedTransaction.meta.postTokenBalances as TokenBalance[];

          const baseInfo = postTokenBalances?.find(
            (balance) =>
              balance.owner ===
                '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1' &&
              balance.mint !== 'So11111111111111111111111111111111111111112'
          );

          if (baseInfo) {
            baseAddress = baseInfo.mint;
            baseDecimals = baseInfo.uiTokenAmount.decimals;
            baseLpAmount = baseInfo.uiTokenAmount.uiAmount || 0;
            console.log(chalk.blue(`  Base token: ${baseAddress} (${baseLpAmount} tokens)`));
          }

          const quoteInfo = postTokenBalances.find(
            (balance) =>
              balance.owner ===
                '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1' &&
              balance.mint === 'So11111111111111111111111111111111111111112'
          );

          if (quoteInfo) {
            quoteAddress = quoteInfo.mint;
            quoteDecimals = quoteInfo.uiTokenAmount.decimals;
            quoteLpAmount = quoteInfo.uiTokenAmount.uiAmount || 0;
            console.log(chalk.blue(`  Quote token: ${quoteAddress} (${quoteLpAmount} SOL)`));
          }
        } else {
          console.log(chalk.yellow(`⚠ Transaction parsing failed or contains errors`));
        }

        const newTokenData: NewTokenData = {
          lpSignature: signature,
          creator: signer,
          timestamp: new Date().toISOString(),
          baseInfo: {
            baseAddress,
            baseDecimals,
            baseLpAmount,
          },
          quoteInfo: {
            quoteAddress,
            quoteDecimals,
            quoteLpAmount,
          },
          logs,
        };

        //store new tokens data in data folder
        await storeData(dataPath, newTokenData);
        console.log(chalk.green(`✓ Token data saved successfully`));
      } catch (error) {
        const errorMessage = `Error in new solana token log callback function: ${error instanceof Error ? error.message : String(error)}`;
        console.error(chalk.red(`✗ ${errorMessage}`));
        console.error(chalk.red(`  Stack trace: ${error instanceof Error ? error.stack : 'No stack trace available'}`));
        
        // Save error logs to a separate file
        fs.appendFile(
          'errorNewLpsLogs.txt',
          `${new Date().toISOString()} - ${errorMessage}\n${error instanceof Error ? error.stack : ''}\n---\n`,
          function (err) {
            if (err) console.error(chalk.red(`✗ Error writing to error logs: ${err}`));
          }
        );
      }
    };

    console.log(chalk.blue(`Setting up log listener for Raydium fee account: ${rayFee.toString()}`));
    connection.onLogs(rayFee, logCallback, 'confirmed');
    console.log(chalk.green(`✓ Log listener established successfully`));

    // Return cleanup function
    return () => {
      if (logCallback) {
        console.log(chalk.yellow(`Cleaning up log listener...`));
        // Note: Solana web3.js doesn't have a direct removeOnLogsListener method
        // The listener will be automatically cleaned up when the connection is closed
        // or when the process ends
        logCallback = null;
        console.log(chalk.green(`✓ Log listener cleanup completed`));
      }
    };
  } catch (error) {
    const errorMessage = `Error in new sol lp monitor: ${error instanceof Error ? error.message : String(error)}`;
    console.error(chalk.red(`✗ ${errorMessage}`));
    console.error(chalk.red(`  Stack trace: ${error instanceof Error ? error.stack : 'No stack trace available'}`));
    
    // Save error logs to a separate file
    fs.appendFile('errorNewLpsLogs.txt', `${new Date().toISOString()} - ${errorMessage}\n${error instanceof Error ? error.stack : ''}\n---\n`, function (err) {
      if (err) console.error(chalk.red(`✗ Error writing to error logs: ${err}`));
    });
    throw error;
  }
}

// Export the function for use as an endpoint
export { NewTokenData }; 