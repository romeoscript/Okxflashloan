import 'dotenv/config';

import { 
    PublicKey,
  } from "@solana/web3.js";
  
export const OKX_API_KEY = process.env.OKX_API_KEY!;

export const OKX_API_SECRET = process.env.OKX_SECRET_KEY!;

export const OKX_API_PASSPHRASE = process.env.OKX_API_PASSPHRASE!;

export const OKX_PROJECT_ID = process.env.OKX_PROJECT_ID!;

export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;

export const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY!;

export const LENDING_PROGRAM_ID = new PublicKey("So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo"); 

export const SUPPLYPUBKEY = new PublicKey("9wyWAgg91rsVe3xjibFdvKgSw4c8FCLDZfYgFWWTnA5w");

export const LENDING_MARKET = new PublicKey("Epa6Sy5rhxCxEdmYu6iKKoFjJamJUJw8myjxuhfX2YJi");

export const RESERVE_ADDRESS = new PublicKey("FcMXW4jYR2SPDGhkSQ8zYTqWdYXMQR3yqyMLpEbt1wrs");

export const FEE_RECEIVER_ADDRESS = new PublicKey("5wo1tFpi4HaVKnemqaXeQnBEpezrJXcXvuztYaPhvgC7");

export const WSOL_MINT_KEY = new PublicKey("So11111111111111111111111111111111111111112");