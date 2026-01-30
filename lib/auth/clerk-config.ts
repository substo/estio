export const CLERK_DEV_FAPI = process.env.NEXT_PUBLIC_CLERK_DOMAIN || "magnetic-squirrel-16.accounts.dev";

/**
 * Helper to determine if we are in "Dev Keys Mode" which requires
 * special handling for satellite domains.
 */
export const isClerkDevMode = () => {
    return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_");
};
