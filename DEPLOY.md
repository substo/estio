# Quick Deployment Guide

## Deploy to Production

```bash
# From your local machine in the project directory:
./deploy-direct.sh
```

This script will:
1. ✅ Sync code to server (excluding node_modules, .next)
2. ✅ Set up environment variables in `.env` (including JWT_SECRET)
3. ✅ Install dependencies
4. ✅ Run database migration (`prisma db push`)
5. ✅ Build the application
6. ✅ Restart PM2
7. ✅ Configure Nginx
8. ✅ Setup SSL certificate

## Post-Deployment

After deployment completes:

1. **Check Status**:
   ```bash
   ssh root@64.226.66.37 'pm2 status'
   ```

2. **View Logs**:
   ```bash
   ssh root@64.226.66.37 'pm2 logs estio-app'
   ```

3. **Test the App**:
   - Visit https://estio.co
   - Should load without errors

4. **Test GHL Integration**:
   - Go to your GHL account
   - Click the "IDX" custom menu link
   - Should authenticate and load dashboard

## If Something Goes Wrong

**Rollback**:
```bash
ssh root@64.226.66.37 'cd /home/martin/estio-app && pm2 restart estio-app'
```

**Clear and Rebuild**:
```bash
ssh root@64.226.66.37 'cd /home/martin/estio-app && rm -rf .next node_modules && npm install && npm run build && pm2 restart estio-app'
```

**Check Prisma**:
```bash
ssh root@64.226.66.37 'cd /home/martin/estio-app && npx prisma studio'
```

## Environment Variables Set

The deployment script automatically sets:
- `JWT_SECRET=ebSkALxOfyQW0/baCofBoqkLUpeoGqpZCXGL7K1/RE0=`
- `SSO_TOKEN_EXPIRY_MINUTES=5`
- `SESSION_EXPIRY_HOURS=24`
- All existing Clerk, GHL, and database variables

## What's New in This Deployment

- ✅ JWT-based SSO authentication
- ✅ GHL-to-Clerk user synchronization
- ✅ Unified authentication system
- ✅ Database schema updates (lastSsoValidation, lastSsoUserId fields)
- ✅ New API endpoints for SSO (/sso/init, /sso/validate, /api/clerk/sign-in-with-token)
- ✅ **Fixed:** Localhost redirect issue in GHL iframe (proxy-aware URL construction)

## Known Issues & Fixes

### Localhost Redirect in GHL Iframe (RESOLVED)
**Issue:** When accessing the app through a GHL Custom Menu Link, the iframe would show "localhost refused to connect".

**Cause:** API routes were using `request.url` to construct redirects, which resolves to `localhost` behind a reverse proxy.

**Fix:** Updated all redirect logic to use the production URL (`https://estio.co`) when `NODE_ENV === 'production'`.

**Affected files:**
- `app/api/clerk/sign-in-with-token/route.ts`
- `app/sso/init/route.ts`
- `app/sso/route.ts`

Ready to deploy!
