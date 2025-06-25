# Supabase Setup Guide

## Step 1: Access Your Supabase Dashboard

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Sign in to your account
3. Select your project: `buenahgmdkftnehbdbin`

## Step 2: Open SQL Editor

1. In your Supabase dashboard, click on **"SQL Editor"** in the left sidebar
2. Click **"New query"** to create a new SQL query

## Step 3: Run the Updated Setup Script

1. Copy the entire contents of the `setup-supabase.sql` file
2. Paste it into the SQL Editor
3. Click **"Run"** to execute the script

**Important**: The updated script will drop existing tables and recreate them with the correct column names.

## Step 4: Verify Tables Were Created

After running the script, you should see a result showing:
- `users` table
- `wallets` table  
- `flash_loan_history` table

## Step 5: Test the Connection

Once the tables are created, your bot should work properly. The database manager will automatically connect to Supabase and use persistent storage.

## Troubleshooting

### If you get permission errors:
- Make sure you're using the correct project
- Check that your API keys are correct in the `.env` file

### If tables still don't exist:
- Make sure you ran the entire SQL script
- Check the SQL Editor for any error messages
- Try running the script again

### If the bot still shows errors:
- Restart the bot after creating the tables
- Check the console logs for any remaining issues

## Your Supabase Credentials

Your current credentials are already set in your `.env` file:
- **Project URL**: https://buenahgmdkftnehbdbin.supabase.co
- **Anon Key**: (already configured)

## Next Steps

After creating the tables:
1. Restart your bot: `npm run dev`
2. Test wallet creation in Telegram
3. All data will now be persisted in Supabase

## Database Schema (Updated)

### Users Table
- `userid`: Telegram user ID (primary key)
- `username`: Telegram username
- `firstname`: User's first name
- `lastname`: User's last name
- `createdat`: When user was created
- `lastactivity`: Last user activity
- `isactive`: Whether user is active

### Wallets Table
- `userid`: References users table
- `publickey`: Wallet public key
- `encryptedprivatekey`: Encrypted private key
- `encryptedmnemonic`: Encrypted seed phrase
- `createdat`: When wallet was created
- `lastactivity`: Last wallet activity
- `isactive`: Whether wallet is active

### Flash Loan History Table
- `id`: Auto-incrementing ID
- `userid`: References users table
- `tokenmint`: Token mint address
- `amount`: Flash loan amount
- `quote`: JSON string of quote data
- `status`: Transaction status (pending, success, failed)
- `signature`: Transaction signature
- `createdat`: When transaction was created

## Column Name Changes

The database now uses lowercase column names to match PostgreSQL conventions:
- `userId` → `userid`
- `publicKey` → `publickey`
- `encryptedPrivateKey` → `encryptedprivatekey`
- `encryptedMnemonic` → `encryptedmnemonic`
- `createdAt` → `createdat`
- `lastActivity` → `lastactivity`
- `isActive` → `isactive`
- `tokenMint` → `tokenmint` 