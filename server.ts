import express from 'express';
import { LaunchDetector } from './sdk/launch_detector';
import { buildSimulatedFlashLoanInstructions } from './sdk/flash_swap';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import dotenv from 'dotenv';
import { Wallet } from '@coral-xyz/anchor';
import bs58 from 'bs58';

dotenv.config();

const app = express();
app.use(express.json());

// Initialize Solana connection and LaunchDetector
const connection = new Connection(process.env.RPC_ENDPOINT || '', 'confirmed');
const detector = new LaunchDetector(connection);

// --- LaunchDetector Endpoints ---

// Get all active launches
app.get('/launches/active', (req, res) => {
  try {
    res.json(detector.getActiveLaunches());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch active launches' });
  }
});

// Start monitoring for new launches
app.post('/launches/start', async (req, res) => {
  try {
    await detector.startMonitoring();
    res.json({ status: 'started' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start monitoring' });
  }
});

// Stop monitoring for launches
app.post('/launches/stop', async (req, res) => {
  try {
    await detector.stopMonitoring();
    res.json({ status: 'stopped' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to stop monitoring' });
  }
});

// Get all active positions
app.get('/positions', (req, res) => {
  try {
    res.json(detector.getActivePositions());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

// --- FlashSwap Endpoints ---

// POST /flashswap/execute
// Body: { targetTokenMint: string, desiredTargetAmount: string, slippageBps?: number, walletPrivateKey: string }
app.post('/flashswap/execute', async (req, res) => {
  try {
    const { targetTokenMint, desiredTargetAmount, slippageBps = 100, walletPrivateKey } = req.body;
    if (!targetTokenMint || !desiredTargetAmount || !walletPrivateKey) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    let keypair;
    try {
      // Try parsing as JSON first
      const secretKey = Uint8Array.from(JSON.parse(walletPrivateKey));
      keypair = Keypair.fromSecretKey(secretKey);
    } catch (e) {
      try {
        // If JSON parsing fails, try base58
        const secretKey = bs58.decode(walletPrivateKey);
        keypair = Keypair.fromSecretKey(secretKey);
      } catch (e2) {
        throw new Error('Invalid private key format. Must be either JSON array or base58 string');
      }
    }

    const wallet = new Wallet(keypair);
    const result = await buildSimulatedFlashLoanInstructions({
      targetTokenMint: new PublicKey(targetTokenMint),
      desiredTargetAmount,
      slippageBps,
      connection,
      wallet
    });

    // Sign the transaction with the keypair
    result.transaction.sign([keypair]);

    // Send the transaction to the network
    const serializedTx = Buffer.from(result.transaction.serialize());
    const signature = await connection.sendRawTransaction(serializedTx, { skipPreflight: false });
    const explorerUrl = `https://solscan.io/tx/${signature}`;

    res.json({
      signature,
      explorerUrl,
      quote: result.quote,
      estimatedOutput: result.estimatedOutput,
      priceImpact: result.priceImpact,
      route: result.route,
      borrowedAmount: result.borrowedAmount,
      addresses: result.addresses
    });
  } catch (err) {
    console.error('FlashSwap execute error:', err);
    res.status(500).json({ error: 'Failed to execute flash swap', details: err instanceof Error ? err.message : err });
  }
});

// GET /flashswap/quote?targetTokenMint=...&desiredTargetAmount=...&slippageBps=...&walletPublicKey=...
app.get('/flashswap/quote', async (req, res) => {
  try {
    const { targetTokenMint, desiredTargetAmount, slippageBps = 100, walletPublicKey } = req.query;
    if (!targetTokenMint || !desiredTargetAmount || !walletPublicKey) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }
    const dummyWallet = { publicKey: new PublicKey(walletPublicKey as string) } as Wallet;
    const result = await buildSimulatedFlashLoanInstructions({
      targetTokenMint: new PublicKey(targetTokenMint as string),
      desiredTargetAmount: desiredTargetAmount as string,
      slippageBps: Number(slippageBps),
      connection,
      wallet: dummyWallet
    });
    res.json({
      quote: result.quote,
      estimatedOutput: result.estimatedOutput,
      priceImpact: result.priceImpact,
      route: result.route,
      borrowedAmount: result.borrowedAmount,
      addresses: result.addresses
    });
  } catch (err) {
    console.error('FlashSwap quote error:', err);
    res.status(500).json({ error: 'Failed to get flash swap quote', details: err instanceof Error ? err.message : err });
  }
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
}); 