# Search Bar & Filter Implementation Guide

This guide details the technical implementation of the Search Box and Filters pattern used in the Properties page (`app/(main)/dashboard/properties`). It is designed to be a reference for implementing similar filtering logic on other pages (e.g., Contacts, Companies).

## 1. Architecture Overview
The filtering system uses a **URL-based Source of Truth** architecture. This means:
- The URL query parameters (search params) hold the current state of all filters.
- The UI components read from the URL to determine what to display.
- Filter actions (selecting an option, typing a search term) update the URL.
- The Server Component (`page.tsx`) reads the URL, parses the parameters, and passes them to the database query.
- **Benefit**: This enables deep linking, browser history navigation (back/forward), and easy sharing of filtered views.

### Data Flow Diagram
```mermaid
graph TD
    User[User Interaction] -->|Updates URL| URL[URL Search Params]
    URL -->|Read by| Page[Server Page (page.tsx)]
    URL -->|Read by| FilterComp[Client Filter Component]
    Page -->|Parses Params| Repository[Repository Layer]
    Repository -->|Constructs WHERE Clause| DB[(Database/Prisma)]
    DB -->|Returns Data| Page
    Page -->|Passes Data| Table[Data Table]
```

## 2. File Structure & Connections
The implementation is distributed across three main layers:

### A. Page Layer (Server Component)
**File**: `app/(main)/dashboard/properties/page.tsx`
- **Role**: Controller.
- **Responsibilities**:
    1. Receives `searchParams` prop.
    2. Parses raw strings into typed variables (integers, arrays).
    3. Calls the repository function (`listProperties`) with parsed params.
    4. Passes initial data (like available owners) to the filter component.

### B. UI Layer (Client Component)
**File**: `components/properties/property-filters.tsx`
- **Role**: View & Interactor.
- **Responsibilities**:
    1. Reads current state from `useSearchParams()`.
    2. Renders filter inputs (Select, Input, Multi-select).
    3. Updates URL using `router.push('?' + newParams)`.
    4. Manages local state for text inputs (to debounce or wait for 'Enter') to avoid excessive URL updates.

### C. Data Layer (Repository)
**File**: `lib/properties/repository.ts`
- **Role**: Model/Data Access.
- **Responsibilities**:
    1. Accepts a structured `params` object.
    2. Dynamically constructs a Prisma `where` clause based on active params.
    3. Execurtes the DB query.

## 3. Detailed Implementation Steps (How to Replicate)

To implement this pattern on a new page (e.g., "Contacts"), follow these steps:

### Step 1: Define Filter Parameters
Decide which fields you want to filter by. In `repository.ts` (or equivalent), define an interface:
```typescript
export interface ListContactsParams {
    q?: string;           // Search term
    status?: string;      // Enum filter
    tags?: string[];      // Array flter
    page?: number;        // Pagination
}
```

### Step 2: Implement Repository Logic
Create a function that translates these params into a Prisma query.
**Pattern**: Start with a base `where` object and conditionally add rules.
```typescript
// lib/contacts/repository.ts
export async function listContacts(params: ListContactsParams) {
    const where: any = { AND: [] };

    // Text Search (OR logic across multiple fields)
    if (params.q) {
        where.AND.push({
            OR: [
                { firstName: { contains: params.q, mode: 'insensitive' } },
                { email: { contains: params.q, mode: 'insensitive' } }
            ]
        });
    }

    // Exact Match
    if (params.status && params.status !== 'all') {
        where.AND.push({ status: params.status });
    }

    // Array Filter (IN logic)
    if (params.tags && params.tags.length > 0) {
        where.AND.push({ tags: { hasSome: params.tags } });
    }

    return db.contact.findMany({ where });
}
```

### Step 3: Create Filter Component
Build a Client Component that manipulates the URL.
**Key Utilities**:
- `useSearchParams()`: To read current values.
- `useRouter()`, `usePathname()`: To push updates.
- `createQueryString` helper: To merge new values with existing ones.

```typescript
// components/contacts/contact-filters.tsx
'use client';

export function ContactFilters() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    // Helper to update one param while keeping others
    const updateFilter = (name: string, value: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (value && value !== 'all') {
            params.set(name, value);
        } else {
            params.delete(name);
        }
        params.delete('skip'); // Always reset pagination on filter change
        router.push(`${pathname}?${params.toString()}`);
    }

    return (
        <div className="flex gap-2">
            <Input 
                placeholder="Search..." 
                defaultValue={searchParams.get('q') || ''}
                onChange={(e) => updateFilter('q', e.target.value)} // Hint: Debounce this in real app
            />
            <Select 
                value={searchParams.get('status') || 'all'}
                onValueChange={(val) => updateFilter('status', val)}
            >
                {/* Options... */}
            </Select>
        </div>
    )
}
```

### Step 4: Integrate in Page
Connect the pieces in your `page.tsx`.
```typescript
// app/(main)/dashboard/contacts/page.tsx
export default async function ContactsPage({ searchParams }: { searchParams: Promise<any> }) {
    const params = await searchParams;
    
    // Parse params (ensure types are correct)
    const filters = {
        q: typeof params.q === 'string' ? params.q : undefined,
        status: typeof params.status === 'string' ? params.status : undefined,
    };

    const data = await listContacts(filters);

    return (
        <div>
            <ContactFilters />
            <ContactTable data={data} />
        </div>
    );
}
```

## 4. Field Types & Best Practices

| Field Type | UI Component | URL Format | Backend Logic |
|------------|-------------|------------|---------------|
| **Search** | `Input` | `?q=term` | `contains` (insensitive) on name/title/slug |
| **Enum** | `Select` | `?status=ACTIVE` | Exact match: `{ status: 'ACTIVE' }` |
| **Multi-Select** | `Popover` + `Command` | `?features=a,b,c` | `in` (OR) or `hasEvery` (AND) |
| **Range** | `Select` or Inputs | `?min=10&max=50` | `{ gte: min, lte: max }` |
| **Boolean** | `Select` or `Switch` | `?hasVideo=true` | `{ videoUrl: { not: null } }` |
| **Reference** | `Select` (Searchable) | `?ownerId=xyz` | `{ ownerId: 'xyz' }` |

### Special "Filter By" Pattern
For ad-hoc filters (e.g. "Missing Price", "Has Coordinates"), use a single `filterBy` parameter mapped to a switch statement in the backend.
- **URL**: `?filterBy=no_price`
- **Backend**:
  ```typescript
  if (params.filterBy === 'no_price') {
      where.AND.push({ price: null });
  }
  ```
