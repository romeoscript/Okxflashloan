import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface UserWallet {
  userId: number;
  publicKey: string;
  encryptedPrivateKey: string;
  encryptedMnemonic: string;
  createdAt: string;
  lastActivity: string;
  isActive: boolean;
}

export interface UserSession {
  userId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  createdAt: string;
  lastActivity: string;
  isActive: boolean;
}

export interface FlashLoanHistory {
  id: number;
  userId: number;
  tokenMint: string;
  amount: string;
  quote?: string;
  status: string;
  signature?: string;
  createdAt: string;
}

export class DatabaseManager {
  private supabase: SupabaseClient | null = null;
  private supabaseUrl: string;
  private supabaseKey: string;
  private fallbackMode: boolean = false;
  
  // In-memory storage for fallback mode
  private users: Map<number, UserSession> = new Map();
  private wallets: Map<number, UserWallet> = new Map();
  private flashLoanHistory: FlashLoanHistory[] = [];

  constructor(supabaseUrl?: string, supabaseKey?: string) {
    this.supabaseUrl = supabaseUrl || process.env.SUPABASE_URL || '';
    this.supabaseKey = supabaseKey || process.env.SUPABASE_ANON_KEY || '';
    
    // Check if we have valid credentials
    if (!this.supabaseUrl || !this.supabaseKey) {
      console.log('⚠️ Supabase credentials not found. Running in fallback mode with in-memory storage.');
      this.fallbackMode = true;
      return;
    }

    this.supabase = createClient(this.supabaseUrl, this.supabaseKey);
    this.initializeDatabase();
  }

  private async initializeDatabase() {
    if (this.fallbackMode) {
      console.log('✅ Fallback mode initialized successfully');
      return;
    }

    try {
      // Create tables if they don't exist (Supabase handles this automatically via migrations)
      // For now, we'll just test the connection
      const { data, error } = await this.supabase!
        .from('users')
        .select('count')
        .limit(1);

      if (error && error.code === '42P01') {
        // Table doesn't exist, we need to create it
        console.log('⚠️ Tables not found. Please run the following SQL in your Supabase dashboard:');
        console.log(this.getCreateTablesSQL());
      } else if (error) {
        console.error('❌ Database connection error:', error);
      } else {
        console.log('✅ Database connected successfully');
      }
    } catch (error) {
      console.error('❌ Database initialization error:', error);
    }
  }

  private getCreateTablesSQL(): string {
    return `
-- Create users table
CREATE TABLE IF NOT EXISTS users (
  userId BIGINT PRIMARY KEY,
  username TEXT,
  firstName TEXT,
  lastName TEXT,
  createdAt TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  lastActivity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  isActive BOOLEAN DEFAULT TRUE
);

-- Create wallets table
CREATE TABLE IF NOT EXISTS wallets (
  userId BIGINT PRIMARY KEY REFERENCES users(userId),
  publicKey TEXT NOT NULL,
  encryptedPrivateKey TEXT NOT NULL,
  encryptedMnemonic TEXT NOT NULL,
  createdAt TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  lastActivity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  isActive BOOLEAN DEFAULT TRUE
);

-- Create flash_loan_history table
CREATE TABLE IF NOT EXISTS flash_loan_history (
  id BIGSERIAL PRIMARY KEY,
  userId BIGINT NOT NULL REFERENCES users(userId),
  tokenMint TEXT NOT NULL,
  amount TEXT NOT NULL,
  quote TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  signature TEXT,
  createdAt TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_active ON users(isActive);
CREATE INDEX IF NOT EXISTS idx_users_last_activity ON users(lastActivity);
CREATE INDEX IF NOT EXISTS idx_wallets_active ON wallets(isActive);
CREATE INDEX IF NOT EXISTS idx_wallets_last_activity ON wallets(lastActivity);
CREATE INDEX IF NOT EXISTS idx_flash_loan_user ON flash_loan_history(userId);
CREATE INDEX IF NOT EXISTS idx_flash_loan_created ON flash_loan_history(createdAt);
    `;
  }

  // User management
  async createUser(userId: number, username?: string, firstName?: string, lastName?: string): Promise<void> {
    if (this.fallbackMode) {
      const user: UserSession = {
        userId,
        username,
        firstName,
        lastName,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        isActive: true
      };
      this.users.set(userId, user);
      return;
    }

    try {
      const { error } = await this.supabase!
        .from('users')
        .upsert({
          userid: userId,
          username,
          firstname: firstName,
          lastname: lastName,
          lastactivity: new Date().toISOString(),
          isactive: true
        });

      if (error) {
        console.error('Error creating user:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  async getUser(userId: number): Promise<UserSession | null> {
    if (this.fallbackMode) {
      return this.users.get(userId) || null;
    }

    if (!this.supabase) {
      console.log('Supabase client is null, falling back to in-memory storage');
      return this.users.get(userId) || null;
    }

    try {
      const { data, error } = await this.supabase
        .from('users')
        .select('*')
        .eq('userid', userId)
        .eq('isactive', true)
        .maybeSingle(); // Use maybeSingle instead of single to avoid error when no rows

      if (error) {
        console.error('Error getting user:', error);
        return null;
      }

      // Map database column names to interface
      return data ? {
        userId: data.userid,
        username: data.username,
        firstName: data.firstname,
        lastName: data.lastname,
        createdAt: data.createdat,
        lastActivity: data.lastactivity,
        isActive: data.isactive
      } : null;
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  }

  async updateUserActivity(userId: number): Promise<void> {
    if (this.fallbackMode) {
      const user = this.users.get(userId);
      if (user) {
        user.lastActivity = new Date().toISOString();
        this.users.set(userId, user);
      }
      return;
    }

    if (!this.supabase) {
      console.log('Supabase client is null, falling back to in-memory storage');
      const user = this.users.get(userId);
      if (user) {
        user.lastActivity = new Date().toISOString();
        this.users.set(userId, user);
      }
      return;
    }

    try {
      const { error } = await this.supabase
        .from('users')
        .update({ lastactivity: new Date().toISOString() })
        .eq('userid', userId);

      if (error) {
        console.error('Error updating user activity:', error);
      }
    } catch (error) {
      console.error('Error updating user activity:', error);
    }
  }

  async getAllUsers(): Promise<UserSession[]> {
    if (this.fallbackMode) {
      return Array.from(this.users.values()).filter(user => user.isActive);
    }

    if (!this.supabase) {
      console.log('Supabase client is null, falling back to in-memory storage');
      return Array.from(this.users.values()).filter(user => user.isActive);
    }

    try {
      const { data, error } = await this.supabase
        .from('users')
        .select('*')
        .eq('isactive', true)
        .order('lastactivity', { ascending: false });

      if (error) {
        console.error('Error getting all users:', error);
        return [];
      }

      // Map database column names to interface
      return (data || []).map(user => ({
        userId: user.userid,
        username: user.username,
        firstName: user.firstname,
        lastName: user.lastname,
        createdAt: user.createdat,
        lastActivity: user.lastactivity,
        isActive: user.isactive
      }));
    } catch (error) {
      console.error('Error getting all users:', error);
      return [];
    }
  }

  // Wallet management
  async createWallet(
    userId: number,
    publicKey: string,
    encryptedPrivateKey: string,
    encryptedMnemonic: string
  ): Promise<void> {
    if (this.fallbackMode) {
      const wallet: UserWallet = {
        userId,
        publicKey,
        encryptedPrivateKey,
        encryptedMnemonic,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        isActive: true
      };
      this.wallets.set(userId, wallet);
      return;
    }

    if (!this.supabase) {
      console.log('Supabase client is null, falling back to in-memory storage');
      const wallet: UserWallet = {
        userId,
        publicKey,
        encryptedPrivateKey,
        encryptedMnemonic,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        isActive: true
      };
      this.wallets.set(userId, wallet);
      return;
    }

    try {
      // First, ensure the user exists
      await this.createUser(userId);

      const { error } = await this.supabase
        .from('wallets')
        .upsert({
          userid: userId,
          publickey: publicKey,
          encryptedprivatekey: encryptedPrivateKey,
          encryptedmnemonic: encryptedMnemonic,
          lastactivity: new Date().toISOString(),
          isactive: true
        });

      if (error) {
        console.error('Error creating wallet:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error creating wallet:', error);
      throw error;
    }
  }

  async getWallet(userId: number): Promise<UserWallet | null> {
    if (this.fallbackMode) {
      return this.wallets.get(userId) || null;
    }

    if (!this.supabase) {
      console.log('Supabase client is null, falling back to in-memory storage');
      return this.wallets.get(userId) || null;
    }

    try {
      const { data, error } = await this.supabase
        .from('wallets')
        .select('*')
        .eq('userid', userId)
        .eq('isactive', true)
        .maybeSingle(); // Use maybeSingle instead of single to avoid error when no rows

      if (error) {
        console.error('Error getting wallet:', error);
        return null;
      }

      // Map database column names to interface
      return data ? {
        userId: data.userid,
        publicKey: data.publickey,
        encryptedPrivateKey: data.encryptedprivatekey,
        encryptedMnemonic: data.encryptedmnemonic,
        createdAt: data.createdat,
        lastActivity: data.lastactivity,
        isActive: data.isactive
      } : null;
    } catch (error) {
      console.error('Error getting wallet:', error);
      return null;
    }
  }

  async updateWalletActivity(userId: number): Promise<void> {
    if (this.fallbackMode) {
      const wallet = this.wallets.get(userId);
      if (wallet) {
        wallet.lastActivity = new Date().toISOString();
        this.wallets.set(userId, wallet);
      }
      return;
    }

    if (!this.supabase) {
      console.log('Supabase client is null, falling back to in-memory storage');
      const wallet = this.wallets.get(userId);
      if (wallet) {
        wallet.lastActivity = new Date().toISOString();
        this.wallets.set(userId, wallet);
      }
      return;
    }

    try {
      const { error } = await this.supabase
        .from('wallets')
        .update({ lastactivity: new Date().toISOString() })
        .eq('userid', userId);

      if (error) {
        console.error('Error updating wallet activity:', error);
      }
    } catch (error) {
      console.error('Error updating wallet activity:', error);
    }
  }

  async deleteWallet(userId: number): Promise<boolean> {
    if (this.fallbackMode) {
      const wallet = this.wallets.get(userId);
      if (wallet) {
        wallet.isActive = false;
        this.wallets.set(userId, wallet);
        return true;
      }
      return false;
    }

    if (!this.supabase) {
      console.log('Supabase client is null, falling back to in-memory storage');
      const wallet = this.wallets.get(userId);
      if (wallet) {
        wallet.isActive = false;
        this.wallets.set(userId, wallet);
        return true;
      }
      return false;
    }

    try {
      const { error } = await this.supabase
        .from('wallets')
        .update({ isactive: false })
        .eq('userid', userId);

      if (error) {
        console.error('Error deleting wallet:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error deleting wallet:', error);
      return false;
    }
  }

  async getAllWallets(): Promise<UserWallet[]> {
    if (this.fallbackMode) {
      console.log('Using fallback mode for getAllWallets');
      return Array.from(this.wallets.values()).filter(wallet => wallet.isActive);
    }

    if (!this.supabase) {
      console.log('Supabase client is null, falling back to in-memory storage');
      return Array.from(this.wallets.values()).filter(wallet => wallet.isActive);
    }

    try {
      const { data, error } = await this.supabase
        .from('wallets')
        .select('*')
        .eq('isactive', true)
        .order('lastactivity', { ascending: false });

      if (error) {
        console.error('Error getting all wallets:', error);
        return [];
      }

      // Map database column names to interface
      return (data || []).map(wallet => ({
        userId: wallet.userid,
        publicKey: wallet.publickey,
        encryptedPrivateKey: wallet.encryptedprivatekey,
        encryptedMnemonic: wallet.encryptedmnemonic,
        createdAt: wallet.createdat,
        lastActivity: wallet.lastactivity,
        isActive: wallet.isactive
      }));
    } catch (error) {
      console.error('Error getting all wallets:', error);
      return [];
    }
  }

  // Flash loan history
  async logFlashLoan(
    userId: number,
    tokenMint: string,
    amount: string,
    quote?: string,
    status: string = 'pending',
    signature?: string
  ): Promise<void> {
    if (this.fallbackMode) {
      const flashLoan: FlashLoanHistory = {
        id: this.flashLoanHistory.length + 1,
        userId,
        tokenMint,
        amount,
        quote: quote ? JSON.stringify(quote) : undefined,
        status,
        signature,
        createdAt: new Date().toISOString()
      };
      this.flashLoanHistory.push(flashLoan);
      return;
    }

    if (!this.supabase) {
      console.log('Supabase client is null, falling back to in-memory storage');
      const flashLoan: FlashLoanHistory = {
        id: this.flashLoanHistory.length + 1,
        userId,
        tokenMint,
        amount,
        quote: quote ? JSON.stringify(quote) : undefined,
        status,
        signature,
        createdAt: new Date().toISOString()
      };
      this.flashLoanHistory.push(flashLoan);
      return;
    }

    try {
      const { error } = await this.supabase
        .from('flash_loan_history')
        .insert({
          userid: userId,
          tokenmint: tokenMint,
          amount,
          quote: quote ? JSON.stringify(quote) : null,
          status,
          signature
        });

      if (error) {
        console.error('Error logging flash loan:', error);
      }
    } catch (error) {
      console.error('Error logging flash loan:', error);
    }
  }

  async getFlashLoanHistory(userId: number, limit: number = 10): Promise<FlashLoanHistory[]> {
    if (this.fallbackMode) {
      return this.flashLoanHistory
        .filter(loan => loan.userId === userId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);
    }

    if (!this.supabase) {
      console.log('Supabase client is null, falling back to in-memory storage');
      return this.flashLoanHistory
        .filter(loan => loan.userId === userId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);
    }

    try {
      const { data, error } = await this.supabase
        .from('flash_loan_history')
        .select('*')
        .eq('userid', userId)
        .order('createdat', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error getting flash loan history:', error);
        return [];
      }

      // Map database column names to interface
      return (data || []).map(loan => ({
        id: loan.id,
        userId: loan.userid,
        tokenMint: loan.tokenmint,
        amount: loan.amount,
        quote: loan.quote,
        status: loan.status,
        signature: loan.signature,
        createdAt: loan.createdat
      }));
    } catch (error) {
      console.error('Error getting flash loan history:', error);
      return [];
    }
  }

  async updateFlashLoanStatus(id: number, status: string, signature?: string): Promise<void> {
    if (this.fallbackMode) {
      const flashLoan = this.flashLoanHistory.find(loan => loan.id === id);
      if (flashLoan) {
        flashLoan.status = status;
        if (signature) {
          flashLoan.signature = signature;
        }
      }
      return;
    }

    if (!this.supabase) {
      console.log('Supabase client is null, falling back to in-memory storage');
      const flashLoan = this.flashLoanHistory.find(loan => loan.id === id);
      if (flashLoan) {
        flashLoan.status = status;
        if (signature) {
          flashLoan.signature = signature;
        }
      }
      return;
    }

    try {
      const updateData: any = { status };
      if (signature) {
        updateData.signature = signature;
      }

      const { error } = await this.supabase
        .from('flash_loan_history')
        .update(updateData)
        .eq('id', id);

      if (error) {
        console.error('Error updating flash loan status:', error);
      }
    } catch (error) {
      console.error('Error updating flash loan status:', error);
    }
  }

  // Statistics
  async getStats(): Promise<{
    totalUsers: number;
    totalWallets: number;
    totalFlashLoans: number;
    activeUsers24h: number;
  }> {
    if (this.fallbackMode) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      const activeUsers24h = Array.from(this.users.values())
        .filter(user => user.isActive && new Date(user.lastActivity) > yesterday).length;

      return {
        totalUsers: this.users.size,
        totalWallets: this.wallets.size,
        totalFlashLoans: this.flashLoanHistory.length,
        activeUsers24h
      };
    }

    if (!this.supabase) {
      console.log('Supabase client is null, falling back to in-memory storage');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      const activeUsers24h = Array.from(this.users.values())
        .filter(user => user.isActive && new Date(user.lastActivity) > yesterday).length;

      return {
        totalUsers: this.users.size,
        totalWallets: this.wallets.size,
        totalFlashLoans: this.flashLoanHistory.length,
        activeUsers24h
      };
    }

    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const [userCount, walletCount, flashLoanCount, activeUsers] = await Promise.all([
        this.supabase.from('users').select('userid', { count: 'exact', head: true }).eq('isactive', true),
        this.supabase.from('wallets').select('userid', { count: 'exact', head: true }).eq('isactive', true),
        this.supabase.from('flash_loan_history').select('id', { count: 'exact', head: true }),
        this.supabase.from('users').select('userid', { count: 'exact', head: true }).eq('isactive', true).gte('lastactivity', yesterday.toISOString())
      ]);

      return {
        totalUsers: userCount.count || 0,
        totalWallets: walletCount.count || 0,
        totalFlashLoans: flashLoanCount.count || 0,
        activeUsers24h: activeUsers.count || 0
      };
    } catch (error) {
      console.error('Error getting stats:', error);
      return {
        totalUsers: 0,
        totalWallets: 0,
        totalFlashLoans: 0,
        activeUsers24h: 0
      };
    }
  }

  // Cleanup
  async close(): Promise<void> {
    // Supabase client doesn't need explicit closing
    console.log('✅ Database connection closed');
  }
} 