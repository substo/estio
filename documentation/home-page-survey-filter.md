# Home Page Survey Filter Documentation

This component implements a futuristic, "Apple-style" survey interface for property filtering on the public home page. It replaces the traditional static search bar with an interactive, multi-step wizard.

## 1. Overview
The `SurveyFilter` guides users through a sequential filtering process:
1.  **Goal**: Buy vs. Rent
2.  **Location**: City/Area selection
3.  **Type**: Property Type (Villa, Apartment, etc.)
4.  **Budget**: Price range (Dynamic based on Sale/Rent)

### Key Features
- **Glassmorphism UI**: Uses `backdrop-blur-xl` and semi-transparent backgrounds to float seamlessly over the hero image.
- **Adaptive Layout**: The container resizes animatedly based on the content (e.g., small pill for Step 1, large grid for Step 2).
- **Dynamic Counting**: Real-time property counts ("Show 12 Properties") displayed on the final button.
- **Fluid Animations**: Powered by `framer-motion` for smooth layout transitions (`layout` prop) and micro-interactions (breathing buttons).
- **Advanced Mode**: Transforms into a full-width filter mode with support for features, conditions, and exact price/bedroom ranges.
- **Parameter Mapping**: Automatically converts abstract choices (e.g., "Budget: Low") into concrete URL parameters (e.g., `max_price=200000`) compatible with the main search engine.
- **Reference Number Search**: Includes a "Ref. No." input. Searching by reference automatically bypasses the "Goal" (Buy/Rent) filter to ensure direct lookups succeed.
- **Restricted Features**: The "Advanced Mode" filter restricts specific features to a curated list (e.g., Pools, Views, Title Deeds) defined in `PUBLIC_FEATURES_LIST`, differentiating the simplified public experience from the full Admin capabilities.

## 2. Architecture

### Backend: `getFilterCount`
- **File**: `lib/public-data.ts`
- **Function**: `getFilterCount(locationId, params)`
- **Logic**: Reuses the core property filtering logic used in the main search but executes a `db.property.count()` query for performance. It does *not* return property data, only the count.

### Server Action: `getFilterCountAction`
- **File**: `app/actions/public-actions.ts`
- **Purpose**: Exposes the backend logic to the Client Component.

### Frontend: `SurveyFilter`
- **File**: `app/(public-site)/[domain]/_components/survey-filter.tsx`
- **State**: Manages `step` (0-3), `filters` (object), and `mode` ('survey' vs 'advanced').
- **Effects**: Triggers `getFilterCountAction` whenever filters change to update the displayed count.
- **Budget Mapping**: Internally maps the "Budget" selection to `min_price` and `max_price` before querying the backend or navigating, ensuring compatibility with standard search filters.
- **Array Parameters**: Handles multi-select inputs (Locations, Types, Bedrooms) by serializing them into comma-separated strings (e.g., `locations=Paphos,Limassol`) for the URL, which are then parsed back into arrays by the Search Page and Backend.

## 3. Interaction Design details

### Step 1: Goal
- **Display**: Two simple buttons ("Buy", "Rent").
- **Animation**: Buttons have a subtle "breathing" effect (scale/shadow pulse) to invite interaction.
- **Alignment**: Centered within a compact, pill-shaped container (`rounded-3xl`).
- **Impact**: Changing this selection dynamically updates available options in future steps (e.g., Budget ranges, Price Dropdowns).

### Transitions
The container uses `motion.div` with the `layout` prop. When switching steps or expanding to "Advanced" mode, the width and height animate smoothly using spring physics.

### Entrance Animation
The entrance fade-in is handled directly by the component to ensure the CSS blur filter is applied correctly throughout the transition, preventing visual artifacts.

## 4. Usage
To use this component in a Hero section:

```tsx
<div className="w-full max-w-5xl">
    <SurveyFilter 
        locationId={locationId}
        primaryColor={primaryColor}
        getFilterCountAction={getFilterCountAction}
    />
</div>
```

## 5. Design & Technical Implementation Details

### Design Congruence
To ensure the component aligns with the overall site aesthetic, it uses global design tokens:
- **Typography**: Uses `font-heading` (Montserrat) for questions to match site headings.
- **Roundness**: Uses `rounded-lg` (Container) and `rounded-md` (Buttons) adhering to the global `--radius` variable.
- **Active States**: Uses the site's `primaryColor` dynamically for active backgrounds instead of generic white.

### Preventing Layout Jumps (Top-Anchoring)
Because the filter expands significantly between Step 1 and Step 2, centering it vertically causes the entire page content to "jump" up.
**Solution**: The Hero Section uses a **Top-Anchored Layout** (`justify-start` + `pt-32` padding) instead of vertical centering. This keeps the headline stationary while the filter expands downwards.

### Unified Layout Animation
To ensure a seamless experience when the filter expands:
1.  **Oversized Static Background**: The Hero background container is static and set to `h-[120vh]` (20% taller than viewport) with `object-top`. This prevents the image from resizing or re-cropping when the viewport height effectively changes during animation.
2.  **Sibling Animation**: Sections immediately following the Hero (e.g., `CategoriesSection`) are wrapped in `motion.section` with the `layout` prop. This allows them to slide down smoothly in sync with the filter's expansion, preserving the physics (`spring`, `0.6s duration`).
