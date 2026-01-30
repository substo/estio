# Quick Setup Commands

## Generate JWT Secret (Run Locally)
```bash
openssl rand -base64 32
```

## Setup on Production Server
```bash
# SSH into server
ssh root@YOUR_SERVER_IP

# Navigate to app directory
cd /home/martin/estio-app

# Add JWT secret (replace with generated value)
echo "JWT_SECRET=YOUR_GENERATED_SECRET_HERE" >> .env

# Add optional config
echo "SSO_TOKEN_EXPIRY_MINUTES=5" >> .env
echo "SESSION_EXPIRY_HOURS=24" >> .env

# Configure allowed user roles (comma-separated)
# Options: admin, user, account-admin, account-user, agency-admin, agency-user
# Recommended for real estate agencies: admin,user
echo "ALLOWED_GHL_ROLES=admin,user" >> .env

# Run database migration
npx prisma migrate deploy
# OR if no migrations:
npx prisma db push

# Restart app
pm2 restart estio-app
pm2 logs estio-app
```

## Custom Menu Link URL
```
https://estio.co/sso/init?userId={{user.id}}&locationId={{location.id}}&userEmail={{user.email}}
```

## Testing Checklist
- [ ] JWT_SECRET added to production .env.local
- [ ] Database migration run
- [ ] PM2 restarted
- [ ] Custom menu link created in GHL
- [ ] Tested as admin user → should see dashboard
- [ ] Tested as non-admin user → should see "Access Denied"
- [ ] Checked cookies are set (DevTools → Application → Cookies)
- [ ] Verified logs show successful SSO flow
