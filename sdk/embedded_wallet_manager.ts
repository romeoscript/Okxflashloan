import { Connection, PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import { Wallet } from '@coral-xyz/anchor';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import bs58 from 'bs58';

// Embedded wallet session interface
export interface EmbeddedWalletSession {
  userId: number;
  walletPublicKey: string;
  walletPrivateKey: string; // Encrypted private key
  mnemonic: string; // Encrypted mnemonic
  connectedAt: Date;
  lastActivity: Date;
  isActive: boolean;
}

// Wallet generation options
export interface WalletGenerationOptions {
  userId: number;
  encryptionKey?: string; // Optional encryption key
}

export class EmbeddedWalletManager {
  private userWallets: Map<number, EmbeddedWalletSession> = new Map();
  private connection: Connection;
  private encryptionKey: string;

  constructor(connection: Connection, encryptionKey?: string) {
    this.connection = connection;
    this.encryptionKey = encryptionKey || process.env.WALLET_ENCRYPTION_KEY || 'default-key-change-in-production';
  }

  /**
   * Generate a new Solana wallet for a user
   */
  async generateWalletForUser(userId: number): Promise<{
    publicKey: string;
    privateKey: string;
    mnemonic: string;
    message: string;
  }> {
    try {
      // Check if user already has a wallet
      const existingWallet = this.userWallets.get(userId);
      if (existingWallet) {
        throw new Error('You already have a wallet. Each user can only create one wallet. Use /walletinfo to view your existing wallet or /exportwallet to export it.');
      }

      // Generate mnemonic (12 words)
      const mnemonic = bip39.generateMnemonic(128); // 12 words
      
      // Derive Solana keypair from mnemonic
      const seed = await bip39.mnemonicToSeed(mnemonic);
      const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
      const keypair = Keypair.fromSeed(derivedSeed);

      // Encrypt sensitive data
      const encryptedPrivateKey = this.encryptData(keypair.secretKey.toString());
      const encryptedMnemonic = this.encryptData(mnemonic);

      // Create wallet session
      const walletSession: EmbeddedWalletSession = {
        userId,
        walletPublicKey: keypair.publicKey.toString(),
        walletPrivateKey: encryptedPrivateKey,
        mnemonic: encryptedMnemonic,
        connectedAt: new Date(),
        lastActivity: new Date(),
        isActive: true
      };

      // Store the wallet
      this.userWallets.set(userId, walletSession);

      // Create welcome message
      const message = this.createWalletWelcomeMessage(keypair.publicKey.toString(), mnemonic);

      return {
        publicKey: keypair.publicKey.toString(),
        privateKey: bs58.encode(keypair.secretKey),
        mnemonic,
        message
      };
    } catch (error) {
      console.error('Error generating wallet for user:', error);
      throw error;
    }
  }

  /**
   * Get user's wallet
   */
  getUserWallet(userId: number): EmbeddedWalletSession | null {
    const session = this.userWallets.get(userId);
    if (session && session.isActive) {
      session.lastActivity = new Date();
      return session;
    }
    return null;
  }

  /**
   * Get user's wallet as a Solana Keypair
   */
  getUserKeypair(userId: number): Keypair | null {
    const session = this.getUserWallet(userId);
    if (!session) return null;

    try {
      const decryptedPrivateKey = this.decryptData(session.walletPrivateKey);
      const privateKeyBytes = new Uint8Array(decryptedPrivateKey.split(',').map(Number));
      return Keypair.fromSecretKey(privateKeyBytes);
    } catch (error) {
      console.error('Error decrypting wallet:', error);
      return null;
    }
  }

  /**
   * Get user's wallet as an Anchor Wallet
   */
  getUserAnchorWallet(userId: number): Wallet | null {
    const keypair = this.getUserKeypair(userId);
    if (!keypair) return null;

    return {
      publicKey: keypair.publicKey,
      payer: keypair,
      signTransaction: async (tx: any) => {
        tx.sign(keypair);
        return tx;
      },
      signAllTransactions: async (txs: any[]) => {
        txs.forEach(tx => tx.sign(keypair));
        return txs;
      }
    };
  }

  /**
   * Check if user has a wallet
   */
  hasWallet(userId: number): boolean {
    const session = this.userWallets.get(userId);
    return session?.isActive === true;
  }

  /**
   * Get wallet balance
   */
  async getWalletBalance(userId: number): Promise<number> {
    const session = this.getUserWallet(userId);
    if (!session) {
      throw new Error('User wallet not found');
    }

    try {
      const publicKey = new PublicKey(session.walletPublicKey);
      const balance = await this.connection.getBalance(publicKey);
      return balance / 1e9; // Convert lamports to SOL
    } catch (error) {
      console.error('Error getting wallet balance:', error);
      throw error;
    }
  }

  /**
   * Get wallet info (public only)
   */
  getWalletInfo(userId: number): { publicKey: string; balance?: number; connectedAt: Date } | null {
    const session = this.getUserWallet(userId);
    if (!session) return null;

    return {
      publicKey: session.walletPublicKey,
      connectedAt: session.connectedAt
    };
  }

  /**
   * Backup wallet (get mnemonic)
   */
  backupWallet(userId: number): string | null {
    const session = this.getUserWallet(userId);
    if (!session) return null;

    try {
      return this.decryptData(session.mnemonic);
    } catch (error) {
      console.error('Error backing up wallet:', error);
      return null;
    }
  }

  /**
   * Delete user's wallet
   */
  deleteWallet(userId: number): boolean {
    const deleted = this.userWallets.delete(userId);
    return deleted;
  }

  /**
   * Get all user wallets
   */
  getAllWallets(): EmbeddedWalletSession[] {
    return Array.from(this.userWallets.values()).filter(session => session.isActive);
  }

  /**
   * Create transaction for user to sign
   */
  createTransactionForUser(
    userId: number,
    instructions: any[],
    recentBlockhash: string
  ): { transaction: VersionedTransaction; message: string } | null {
    const keypair = this.getUserKeypair(userId);
    if (!keypair) return null;

    try {
      // Create transaction message
      const { TransactionMessage } = require('@solana/web3.js');
      const messageV0 = new TransactionMessage({
        payerKey: keypair.publicKey,
        recentBlockhash,
        instructions
      }).compileToV0Message();

      const transaction = new VersionedTransaction(messageV0);
      
      // Create a message for the user
      const message = `Your embedded wallet will sign this transaction automatically.

Transaction includes:
- Flash loan from Solend
- Token swap via Jupiter  
- Flash loan repayment

Wallet: ${keypair.publicKey.toString()}

⚠️ This transaction will be signed and executed automatically!`;
      
      return { transaction, message };
    } catch (error) {
      console.error('Error creating transaction for user:', error);
      return null;
    }
  }

  /**
   * Execute transaction with user's wallet
   */
  async executeTransactionWithUserWallet(
    userId: number,
    transaction: VersionedTransaction
  ): Promise<string> {
    const keypair = this.getUserKeypair(userId);
    if (!keypair) {
      throw new Error('User wallet not found');
    }

    try {
      // Sign the transaction
      transaction.sign([keypair]);

      // Send the signed transaction
      const signature = await this.connection.sendTransaction(transaction, {
        skipPreflight: false
      });
      
      return signature;
    } catch (error) {
      console.error('Error executing transaction with user wallet:', error);
      throw error;
    }
  }

  /**
   * Simple encryption (in production, use proper encryption)
   */
  private encryptData(data: string): string {
    // Simple XOR encryption for demo (use proper encryption in production)
    const key = this.encryptionKey;
    let encrypted = '';
    for (let i = 0; i < data.length; i++) {
      encrypted += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return Buffer.from(encrypted).toString('base64');
  }

  /**
   * Simple decryption (in production, use proper decryption)
   */
  private decryptData(encryptedData: string): string {
    // Simple XOR decryption for demo (use proper decryption in production)
    const key = this.encryptionKey;
    const data = Buffer.from(encryptedData, 'base64').toString();
    let decrypted = '';
    for (let i = 0; i < data.length; i++) {
      decrypted += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return decrypted;
  }

  /**
   * Create welcome message for new wallet
   */
  private createWalletWelcomeMessage(publicKey: string, mnemonic: string): string {
    // Escape special characters for Telegram markdown
    const escapedPublicKey = publicKey.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
    const escapedMnemonic = mnemonic.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
    
    return `🎉 *Your Embedded Wallet is Ready\\!*

👛 *Wallet Address:* \`${escapedPublicKey}\`
🔐 *Seed Phrase:* \`${escapedMnemonic}\`

**Important Security Notes:**
• Save your seed phrase securely \\- it's your backup
• Never share your seed phrase with anyone
• You can import this wallet into Phantom, Solflare, etc\\.
• Your wallet is ready for flash loans and swaps\\!

**Next Steps:**
• Use /flashquote TOKEN\\_MINT to get a quote
• Use the "Flash Quote" button to get started
• Your wallet will sign transactions automatically

⚠️ *Keep your seed phrase safe \\- it's the only way to recover your wallet\\!*`;
  }

  /**
   * Clean up old wallets
   */
  cleanupOldWallets(maxAgeHours: number = 24): void {
    const now = new Date();
    const maxAge = maxAgeHours * 60 * 60 * 1000; // Convert to milliseconds
    
    for (const [userId, session] of this.userWallets.entries()) {
      if (now.getTime() - session.lastActivity.getTime() > maxAge) {
        this.userWallets.delete(userId);
      }
    }
  }

  /**
   * Export wallet private key
   */
  exportPrivateKey(userId: number): string | null {
    const session = this.getUserWallet(userId);
    if (!session) return null;

    try {
      const decryptedPrivateKey = this.decryptData(session.walletPrivateKey);
      const privateKeyBytes = new Uint8Array(decryptedPrivateKey.split(',').map(Number));
      return bs58.encode(privateKeyBytes);
    } catch (error) {
      console.error('Error exporting private key:', error);
      return null;
    }
  }

  /**
   * Export wallet in multiple formats
   */
  exportWallet(userId: number): {
    publicKey: string;
    privateKey: string;
    mnemonic: string;
    message: string;
  } | null {
    const session = this.getUserWallet(userId);
    if (!session) return null;

    try {
      const mnemonic = this.decryptData(session.mnemonic);
      const privateKey = this.exportPrivateKey(userId);
      
      if (!privateKey) {
        throw new Error('Failed to export private key');
      }

      const message = this.createWalletExportMessage(session.walletPublicKey, privateKey, mnemonic);

      return {
        publicKey: session.walletPublicKey,
        privateKey,
        mnemonic,
        message
      };
    } catch (error) {
      console.error('Error exporting wallet:', error);
      return null;
    }
  }

  /**
   * Create export message for wallet
   */
  private createWalletExportMessage(publicKey: string, privateKey: string, mnemonic: string): string {
    // Escape special characters for Telegram markdown
    const escapedPublicKey = publicKey.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
    const escapedPrivateKey = privateKey.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
    const escapedMnemonic = mnemonic.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
    
    return `📤 *Wallet Export*

👛 *Public Key:* \`${escapedPublicKey}\`
🔑 *Private Key:* \`${escapedPrivateKey}\`
🔐 *Seed Phrase:* \`${escapedMnemonic}\`

**Export Formats:**
• **Private Key:** Use this to import into Phantom, Solflare, etc\\.
• **Seed Phrase:** Use this for hardware wallets or other apps
• **Public Key:** Share this for receiving funds

**Import Instructions:**
• **Phantom:** Settings → Import Private Key
• **Solflare:** Settings → Import Wallet → Private Key
• **Hardware Wallets:** Use the seed phrase

⚠️ *Security Warning:*
• Keep your private key and seed phrase secure
• Never share them with anyone
• Anyone with these can access your funds
• Store them offline in a secure location

**Supported Wallets:**
• Phantom, Solflare, Sollet
• Hardware wallets (Ledger, Trezor)
• Any Solana wallet supporting private key import
    `;
  }
} 