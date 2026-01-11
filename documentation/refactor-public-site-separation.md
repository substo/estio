# Refactoring Log - 2025-12-07

## Objectives
*   Separate the Public Site's theming and font loading from the Dashboard application.
*   Implement a dedicated design system for the Public Site (Phase 1 Foundations).

## Changes

### 1. Route Group Implementation
The application structure was refactored to use Next.js **Route Groups**.

*   **Moved:** All dashboard and main application logic was moved from `app/*` into `app/(main)/*`.
    *   `app/(auth)` -> `app/(main)/(auth)`
    *   `app/admin` -> `app/(main)/admin`
    *   `app/marketing` -> `app/(main)/marketing`
    *   `app/layout.tsx` -> `app/(main)/layout.tsx`
    *   `app/provider.tsx` -> `app/(main)/provider.tsx`

*   **Retained:** `app/(public-site)` remains as a sibling to `(main)`.

### 2. Independent Layouts
This separation allows for two distinct Root Layouts:

1.  **Dashboard Layout** (`app/(main)/layout.tsx`):
    *   Uses `GeistSans`.
    *   Wraps the app in `AuthWrapper` (Clerk), `ThemeProvider` (Shadcn), and `Toaster`.
    *   Imports global styles from `../globals.css`.

2.  **Public Site Layout** (`app/(public-site)/[domain]/layout.tsx`):
    *   Uses `Montserrat` (Headings) and `Inter` (Body).
    *   **Does NOT** use the global `ThemeProvider` or `AuthWrapper` to avoid leaking dashboard styles/auth logic.
    *   Injects a dynamic CSS variable `--primary-brand` based on `SiteConfig`.

### 3. File Updates
*   **`app/globals.css`**: Updated to include the new Public Site variable structure (`--primary-brand`) and default values (Deep Burgundy).
*   **`tailwind.config.ts`**: Added `font-heading` and `font-sans` families.

## Impact on Development
*   **Dashboard Work**: Proceed as normal in `app/(main)/admin`.
*   **Public Site Work**: Modify invalidation logic, layouts, or components in `app/(public-site)`.
*   **Shared Components**: Components in `components/` can be used by both, but be mindful of the different font contexts.
