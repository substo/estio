# Getting Started

## Prerequisites
- Node.js and yarn/bun installed
- Accounts and API keys for:
  - Supabase
  - Stripe (if using payments)
  - Clerk (if using authentication)

## Setup

1. Clone the repository:
   ```
   git clone <repository-url>
   cd <project-directory>
   ```

2. Install dependencies:
   ```
   yarn
   ```

3. Set up environment variables:
   Create a `.env` file in the root directory with the following variables:
   ```
   ```
   # Database
   DATABASE_URL=<your-transaction-pooler-url>
   DIRECT_URL=<your-session-pooler-url>

   # If using Stripe
   STRIPE_SECRET_KEY=<your-stripe-secret-key>
   NEXT_PUBLIC_STRIPE_PRICE_ID=<your-stripe-price-id>

   # If using Clerk
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<your-clerk-publishable-key>
   CLERK_SECRET_KEY=<your-clerk-secret-key>
   NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
   NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
   NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
   NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/

   # GHL SSO (JWT Authentication)
   JWT_SECRET=<your-generated-jwt-secret>
   SSO_TOKEN_EXPIRY_MINUTES=5
   SESSION_EXPIRY_HOURS=24
   GHL_CLIENT_ID=<your-ghl-client-id>
   GHL_CLIENT_SECRET=<your-ghl-client-secret>
    
    # Permission Configuration
    ALLOWED_GHL_ROLES="admin,user" # Comma-separated list of allowed GHL roles (e.g. "admin,user")
    APP_BASE_URL="https://your-app-domain.com" # Required for correct redirects behind proxy
    ```

# Database Configuration Note:
# If using Supabase Transaction Pooler (port 6543), you MUST append ?pgbouncer=true to the DATABASE_URL
# Example: postgresql://user:pass@host:6543/db?pgbouncer=true

4. Configure features:
   In `config.ts`, set the desired features:
   ```typescript
   const config = {
     auth: {
       enabled: true, // Set to false if not using Clerk
     },
     payments: {
       enabled: true, // Set to false if not using Stripe
     }
   };
   ```

5. Set up the database:
   Run Prisma migrations:
   ```
   npx prisma migrate dev
   ```

6. Start the development server:
   ```
   yarn dev
   ```

7. Open your browser and navigate to `http://localhost:3000` to see your application running.

## Additional Configuration

- Webhooks: Set up webhooks for Clerk (if using auth) at `/api/auth/webhook` and for Stripe (if using payments) at `/api/payments/webhook`.
- Customize the landing page, dashboard, and other components as needed.
- Modify the Prisma schema in `prisma/schema.prisma` if you need to change the database structure.

## Important Security Notes

- Enable Row Level Security (RLS) in your Supabase project to ensure data protection at the database level.
- Always make Supabase calls on the server-side (in API routes or server components) to keep your service key secure.

## Learn More

Refer to the documentation of the individual technologies used in this project for more detailed information:
- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Supabase Documentation](https://supabase.io/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Clerk Documentation](https://clerk.dev/docs) (if using auth)
- [Stripe Documentation](https://stripe.com/docs) (if using payments)
