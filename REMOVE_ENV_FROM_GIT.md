# How to Remove .env from GitHub

If your `.env` file was accidentally pushed to GitHub, follow these steps to remove it:

## ⚠️ IMPORTANT WARNING

Once a file is pushed to GitHub, it remains in the repository history even after deletion. If your `.env` contains sensitive information (API keys, passwords, session IDs), you should:

1. **Rotate all secrets** immediately (generate new API keys, session IDs, etc.)
2. **Remove the file from Git history**
3. **Prevent future commits**

---

## 🔍 Step 1: Check if .env is Tracked

```bash
git ls-files | grep ".env"
```

**If you see `.env` in the output**, it's being tracked by Git and needs to be removed.

---

## 🗑️ Step 2: Remove .env from Git (Keep Local Copy)

```bash
# Remove from Git tracking but keep the local file
git rm --cached .env

# Commit the removal
git commit -m "Remove .env from repository"

# Push to GitHub
git push origin main
```

---

## 🧹 Step 3: Remove from Git History (Optional but Recommended)

If `.env` was previously committed, it still exists in Git history. To completely remove it:

### Option A: Using BFG Repo-Cleaner (Recommended)

```bash
# Install BFG (if not already installed)
# Download from: https://rtyley.github.io/bfg-repo-cleaner/

# Clone a fresh copy of your repo
git clone --mirror https://github.com/YOUR_USERNAME/MEGA-MD.git

# Remove .env from all commits
java -jar bfg.jar --delete-files .env MEGA-MD.git

# Clean up
cd MEGA-MD.git
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Force push (⚠️ WARNING: This rewrites history!)
git push --force
```

### Option B: Using git filter-branch

```bash
# Remove .env from all commits
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env" \
  --prune-empty --tag-name-filter cat -- --all

# Force push (⚠️ WARNING: This rewrites history!)
git push origin --force --all
```

---

## ✅ Step 4: Verify .gitignore

Make sure `.env` is in your `.gitignore`:

```bash
# Check if .env is in .gitignore
grep ".env" .gitignore
```

If not, add it:

```bash
echo ".env" >> .gitignore
git add .gitignore
git commit -m "Add .env to .gitignore"
git push
```

---

## 🔐 Step 5: Rotate All Secrets

**CRITICAL:** If `.env` was exposed on GitHub, assume all secrets are compromised:

1. **SESSION_ID**: Delete and regenerate a new session
2. **API Keys**: Regenerate all API keys (REMOVEBG_KEY, etc.)
3. **Database URLs**: Change passwords if they were exposed
4. **PAIRING_NUMBER**: Not sensitive, but be aware it was exposed

---

## 📋 Step 6: Use sample.env Instead

For your repository, commit `sample.env` as a template:

```bash
# sample.env should have empty values
git add sample.env
git commit -m "Add sample.env template"
git push
```

Users can then copy it:

```bash
cp sample.env .env
# Then fill in their own values
```

---

## 🛡️ Prevention Tips

1. **Always check before committing:**
   ```bash
   git status
   ```

2. **Use .gitignore from the start**

3. **Use git hooks to prevent commits:**
   Create `.git/hooks/pre-commit`:
   ```bash
   #!/bin/sh
   if git diff --cached --name-only | grep -q "^.env$"; then
       echo "ERROR: Attempting to commit .env file!"
       exit 1
   fi
   ```

4. **Use environment variable services:**
   - GitHub Secrets (for GitHub Actions)
   - Vercel Environment Variables
   - Railway Environment Variables
   - Render Environment Variables

---

## 📞 Need Help?

If you've accidentally exposed sensitive data:

1. **Immediately rotate all secrets**
2. **Contact GitHub Support** to request cache clearing
3. **Monitor for unauthorized access**

---

## ✅ Checklist

- [ ] Removed `.env` from Git tracking
- [ ] Removed `.env` from Git history (if needed)
- [ ] Verified `.env` is in `.gitignore`
- [ ] Rotated all exposed secrets
- [ ] Committed `sample.env` as template
- [ ] Tested that `.env` is no longer tracked

---

**Remember:** Prevention is better than cure. Always double-check before committing!
