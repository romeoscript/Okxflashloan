-- Supabase Database Setup Script
-- Run this in your Supabase SQL Editor

-- Drop existing tables if they exist (to fix column name issues)
DROP TABLE IF EXISTS flash_loan_history CASCADE;
DROP TABLE IF EXISTS wallets CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  userid BIGINT PRIMARY KEY,
  username TEXT,
  firstname TEXT,
  lastname TEXT,
  createdat TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  lastactivity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  isactive BOOLEAN DEFAULT TRUE
);

-- Create wallets table
CREATE TABLE IF NOT EXISTS wallets (
  userid BIGINT PRIMARY KEY REFERENCES users(userid),
  publickey TEXT NOT NULL,
  encryptedprivatekey TEXT NOT NULL,
  encryptedmnemonic TEXT NOT NULL,
  createdat TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  lastactivity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  isactive BOOLEAN DEFAULT TRUE
);

-- Create flash_loan_history table
CREATE TABLE IF NOT EXISTS flash_loan_history (
  id BIGSERIAL PRIMARY KEY,
  userid BIGINT NOT NULL REFERENCES users(userid),
  tokenmint TEXT NOT NULL,
  amount TEXT NOT NULL,
  quote TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  signature TEXT,
  createdat TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_active ON users(isactive);
CREATE INDEX IF NOT EXISTS idx_users_last_activity ON users(lastactivity);
CREATE INDEX IF NOT EXISTS idx_wallets_active ON wallets(isactive);
CREATE INDEX IF NOT EXISTS idx_wallets_last_activity ON wallets(lastactivity);
CREATE INDEX IF NOT EXISTS idx_flash_loan_user ON flash_loan_history(userid);
CREATE INDEX IF NOT EXISTS idx_flash_loan_created ON flash_loan_history(createdat);

-- For now, disable RLS to allow operations (you can enable it later with proper policies)
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE flash_loan_history ENABLE ROW LEVEL SECURITY;

-- If you want to enable RLS later, uncomment the above lines and add these policies:
-- CREATE POLICY "Enable all operations for authenticated users" ON users FOR ALL USING (true);
-- CREATE POLICY "Enable all operations for authenticated users" ON wallets FOR ALL USING (true);
-- CREATE POLICY "Enable all operations for authenticated users" ON flash_loan_history FOR ALL USING (true);

-- Verify tables were created
SELECT 
  table_name, 
  table_type 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('users', 'wallets', 'flash_loan_history')
ORDER BY table_name; 