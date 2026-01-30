# Manual Setup Steps Required

Before running automated deployment, please complete these 2 steps:

## Step 1: Create GitHub Repository (2 minutes)

1. Go to: https://github.com/new
2. Repository name: `estio-app`
3. Description: `Real Estate IDX integration for GoHighLevel`
4. Privacy: **Private**
5. **Important**: DO NOT check any initialization options (no README, no .gitignore, no license)
6. Click "Create repository"
7. You'll see a quick setup page - that's perfect, don't do anything there

## Step 2: Configure Cloudflare DNS (1 minute)

1. Go to: https://dash.cloudflare.com
2. Select your domain: **substo.com**
3. Click **DNS** in the left sidebar
4. Click **"+ Add record"**  
5. Fill in:
   ```
   Type: A
   Name: idx
   IPv4 address: 64.226.66.37
   Proxy status: DNS only (click to make it gray cloud, not orange)
   TTL: Auto
   ```
6. Click **Save**

## Verification

After Step 2, wait 1-2 minutes and test:

```bash
dig estio.co
# Should return: estio.co. 300 IN A 64.226.66.37
```

---

## What Happens Next

Once you confirm these are done, I'll:
1. Push your code to GitHub
2. Run the automated deployment script that:
   - Clones code to your droplet
   - Installs dependencies
   - Builds Next.js app
   - Sets up PM2
   - Configures Nginx
   - Installs SSL certificate

Everything else is automated! Let me know when Steps 1 & 2 are complete.
