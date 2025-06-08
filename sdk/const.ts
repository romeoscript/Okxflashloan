import 'dotenv/config';

import { 
    PublicKey,
  } from "@solana/web3.js";
  
export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;

export const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY!;

// Environment detection
export const isDevnet = SOLANA_RPC_URL.includes('devnet');
export const SOLEND_ENVIRONMENT = isDevnet ? "devnet" : "production";

// Solend Protocol constants
export const LENDING_PROGRAM_ID = new PublicKey("So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo"); 

export const SUPPLYPUBKEY = new PublicKey("9wyWAgg91rsVe3xjibFdvKgSw4c8FCLDZfYgFWWTnA5w");

export const LENDING_MARKET = new PublicKey("Epa6Sy5rhxCxEdmYu6iKKoFjJamJUJw8myjxuhfX2YJi");

export const RESERVE_ADDRESS = new PublicKey("FcMXW4jYR2SPDGhkSQ8zYTqWdYXMQR3yqyMLpEbt1wrs");

export const FEE_RECEIVER_ADDRESS = new PublicKey("5wo1tFpi4HaVKnemqaXeQnBEpezrJXcXvuztYaPhvgC7");

// Token mints
export const WSOL_MINT_KEY = new PublicKey("So11111111111111111111111111111111111111112");

export const USDC_MINT_KEY = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");