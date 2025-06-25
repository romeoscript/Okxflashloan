# Supabase Setup Guide

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up/login
2. Click "New Project"
3. Choose your organization
4. Enter project details:
   - **Name**: `solana-flash-loan-bot`
   - **Database Password**: Choose a strong password
   - **Region**: Choose closest to your users
5. Click "Create new project"

## 2. Get Your Supabase Credentials

1. Go to your project dashboard
2. Click on "Settings" → "API"
3. Copy the following values:
   - **Project URL** (SUPABASE_URL)
   - **anon public** key (SUPABASE_ANON_KEY)

## 3. Install Dependencies

```bash
npm install @supabase/supabase-js
```

## 4. Set Environment Variables

Add these to your `.env` file:

```env
SUPABASE_URL=your_project_url_here
SUPABASE_ANON_KEY=your_anon_key_here
```

## 5. Create Database Tables

1. Go to your Supabase dashboard
2. Click on "SQL Editor"
3. Run the following SQL:

```sql
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
```

## 6. Configure Row Level Security (RLS)

For security, enable RLS on your tables:

```sql
-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE flash_loan_history ENABLE ROW LEVEL SECURITY;

-- Create policies (optional - for additional security)
-- You can customize these based on your needs
```

## 7. Test the Connection

The bot will automatically test the connection when it starts. You should see:
```
✅ Database connected successfully
```

## Benefits of Using Supabase

✅ **Persistent Storage**: Data survives server restarts
✅ **Scalable**: Handles multiple users and high traffic
✅ **Real-time**: Built-in real-time subscriptions
✅ **Backup**: Automatic backups and point-in-time recovery
✅ **Security**: Row Level Security and built-in auth
✅ **Dashboard**: Easy to view and manage data
✅ **API**: REST and GraphQL APIs included

## Database Schema

### Users Table
- `userId`: Telegram user ID (primary key)
- `username`: Telegram username
- `firstName`: User's first name
- `lastName`: User's last name
- `createdAt`: When user was created
- `lastActivity`: Last user activity
- `isActive`: Whether user is active

### Wallets Table
- `userId`: References users table
- `publicKey`: Wallet public key
- `encryptedPrivateKey`: Encrypted private key
- `encryptedMnemonic`: Encrypted seed phrase
- `createdAt`: When wallet was created
- `lastActivity`: Last wallet activity
- `isActive`: Whether wallet is active

### Flash Loan History Table
- `id`: Auto-incrementing ID
- `userId`: References users table
- `tokenMint`: Token mint address
- `amount`: Flash loan amount
- `quote`: JSON string of quote data
- `status`: Transaction status (pending, success, failed)
- `signature`: Transaction signature
- `createdAt`: When transaction was created 