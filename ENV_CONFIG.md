# Environment Variables Configuration Guide

This document explains all available environment variables for PGWIZ-MD bot configuration.

## 🔐 Authentication & Session

### `SESSION_ID`
- **Description**: Your bot session ID from the pairing service
- **Required**: Yes (for first-time setup)
- **Example**: `SESSION_ID="PGWIZ_MD_abc123xyz"`

### `PAIRING_NUMBER`
- **Description**: Phone number for pairing code generation (without + or spaces)
- **Format**: Country code + number (e.g., `254789462334`)
- **Example**: `PAIRING_NUMBER="254789462334"`

---

## 🗄️ Database Configuration

### `DB_URL`
- **Description**: SQLite database file path
- **Default**: `./baileys_store.db`
- **Example**: `DB_URL="./baileys_store.db"`

### `MONGO_URL`
- **Description**: MongoDB connection string (for unlimited storage)
- **Optional**: Yes
- **Example**: `MONGO_URL="mongodb+srv://user:pass@cluster.mongodb.net/dbname"`

### `POSTGRES_URL`
- **Description**: PostgreSQL connection string (for unlimited storage)
- **Optional**: Yes
- **Example**: `POSTGRES_URL="postgresql://user:pass@host:5432/dbname"`

### `MYSQL_URL`
- **Description**: MySQL connection string (for unlimited storage)
- **Optional**: Yes
- **Example**: `MYSQL_URL="mysql://user:pass@host:3306/dbname"`

---

## 🌐 Server Configuration

### `PORT`
- **Description**: HTTP server port
- **Default**: `5000`
- **Example**: `PORT="5000"`

---

## 📱 Auto Status Configuration

### `AUTO_STATUS_VIEW`
- **Description**: Automatically view all WhatsApp statuses
- **Values**: `"true"` or `"false"`
- **Default**: `"false"`
- **Example**: `AUTO_STATUS_VIEW="true"`

### `AUTO_STATUS_REACT`
- **Description**: Automatically react to all WhatsApp statuses
- **Values**: `"true"` or `"false"`
- **Default**: `"false"`
- **Example**: `AUTO_STATUS_REACT="true"`

### `STATUS_EMOJIS`
- **Description**: Comma-separated list of emojis for status reactions
- **Default**: `"💚,❤️,🔥,😍,👏"`
- **Example**: `STATUS_EMOJIS="💚,❤️,🔥,😍,👏,🎉,✨"`

---

## 👑 Sudo Users Configuration

### `SUDO_USERS`
- **Description**: Comma-separated list of phone numbers with elevated privileges
- **Format**: Country code + number (without + or spaces)
- **Optional**: Yes
- **Example**: `SUDO_USERS="254789462334,1234567890,9876543210"`

**What Sudo Users Can Do:**
- Use owner-only commands (except strict owner commands like `.sudo`)
- Bypass private mode restrictions
- Manage groups, settings, and features
- Almost like being the owner

---

## 🔑 API Keys

### `REMOVEBG_KEY`
- **Description**: Remove.bg API key for background removal
- **Optional**: Yes
- **Example**: `REMOVEBG_KEY="your_api_key_here"`

---

## 📝 Example `.env` File

```env
# Authentication
SESSION_ID="PGWIZ_MD_abc123xyz"
PAIRING_NUMBER="254789462334"

# Database
DB_URL="./baileys_store.db"
# MONGO_URL="mongodb+srv://user:pass@cluster.mongodb.net/dbname"

# Server
PORT="5000"

# Auto Status
AUTO_STATUS_VIEW="true"
AUTO_STATUS_REACT="true"
STATUS_EMOJIS="💚,❤️,🔥,😍,👏"

# Sudo Users
SUDO_USERS="254789462334,1234567890"

# API Keys
REMOVEBG_KEY="your_api_key_here"
```

---

## 🚀 How It Works

### **Bidirectional Sync** 🔄

The bot now supports **two-way synchronization** between `.env` file and the database/config files:

#### **📥 Read from `.env` (Initialization)**

When you start the bot for the **first time** (no existing database or config files):

1. **Auto Status**: 
   - Reads `AUTO_STATUS_VIEW` and `AUTO_STATUS_REACT` from `.env`
   - Initializes settings in database/config files
   - Logs: `[AUTOSTATUS] Initialized from environment variables`

2. **Sudo Users**:
   - Reads `SUDO_USERS` from `.env`
   - Parses comma-separated phone numbers
   - Adds them to database/config files
   - Logs: `[SUDO] Initialized from environment variables`

#### **📤 Write to `.env` (Sync Back)**

When you change settings via bot commands:

1. **Auto Status Commands** (`.autostatus on/off`, `.autostatus react on/off`):
   - Updates database/config files
   - **Automatically writes back to `.env`**
   - Updates `AUTO_STATUS_VIEW` and `AUTO_STATUS_REACT`
   - Logs: `[ENV] Updated AUTO_STATUS_VIEW="true"`

2. **Sudo Commands** (`.sudo add`, `.sudo del`):
   - Updates database/config files
   - **Automatically writes back to `.env`**
   - Updates `SUDO_USERS` with current list
   - Logs: `[ENV] Updated SUDO_USERS="254789462334,1234567890"`

#### **✨ Benefits**

- ✅ **Always in Sync**: `.env` file always reflects current settings
- ✅ **Portable**: Copy `.env` to another deployment and settings carry over
- ✅ **Transparent**: See current configuration at a glance
- ✅ **No Manual Editing**: Bot manages `.env` for you

---

## 📝 Example Workflow

### Initial Setup

1. **Edit `.env`**:
```env
AUTO_STATUS_VIEW="true"
AUTO_STATUS_REACT="true"
SUDO_USERS="254789462334,1234567890"
```

2. **Start Bot**:
```bash
npm start
```

3. **Bot Logs**:
```
[AUTOSTATUS] Initialized from environment variables: { enabled: true, reactOn: true }
[SUDO] Initialized from environment variables: [ '254789462334@s.whatsapp.net', '1234567890@s.whatsapp.net' ]
```

### Changing Settings via Commands

1. **Disable Auto React**:
```
.autostatus react off
```

2. **Bot Updates `.env`**:
```
[ENV] Updated AUTO_STATUS_REACT="false"
```

3. **Your `.env` Now Shows**:
```env
AUTO_STATUS_VIEW="true"
AUTO_STATUS_REACT="false"  # ← Automatically updated!
SUDO_USERS="254789462334,1234567890"
```

### Adding Sudo User

1. **Add User**:
```
.sudo add @user
```

2. **Bot Updates `.env`**:
```
[ENV] Updated SUDO_USERS="254789462334,1234567890,9876543210"
```

3. **Your `.env` Now Shows**:
```env
SUDO_USERS="254789462334,1234567890,9876543210"  # ← Automatically updated!
```

---

## 🔄 Re-initializing from Environment Variables

You **don't need to** re-initialize anymore! The `.env` file is always kept in sync.

However, if you want to force a reset:

**Option 1: Delete database**
```bash
rm baileys_store.db
```

**Option 2: Delete config files**
```bash
rm data/autoStatus.json
rm data/userGroupData.json
```

Then restart the bot, and it will read from `.env` again.

---

## 💡 Tips

1. **Always use quotes** around values in `.env` file
2. **No spaces** in phone numbers (use `254789462334`, not `254 789 462 334`)
3. **Comma-separated** for multiple values (no spaces after commas)
4. **Restart the bot** after changing `.env` file
5. **Delete database/config files** to re-initialize from `.env` (⚠️ This will reset all settings!)

---

## 🔄 Re-initializing from Environment Variables

If you want to reset and re-initialize from `.env`:

**With Database:**
```bash
# Delete the database
rm baileys_store.db
# Restart bot
```

**With File System:**
```bash
# Delete config files
rm data/autoStatus.json
rm data/userGroupData.json
# Restart bot
```

---

## 📞 Support

For more help, join our WhatsApp channel:
https://whatsapp.com/channel/0029Va8cpObHwXbDoZE9VY3K
