# Implementation Tips & Common Pitfalls

This document serves as a knowledge base for common issues and solutions encountered during development in this codebase.

## 1. Forms & Tabs (Radix UI / Shadcn)

### Problem: Missing Data from Inactive Tabs
When using a form split across multiple `TabsContent` components, fields in inactive tabs are often removed from the DOM by default. This causes `FormData` to be missing those fields upon submission, leading to validation errors.

### Solution: Force Mount & CSS Hiding
Configure `TabsContent` to remain mounted even when inactive, and use CSS to hide it visually.

```tsx
<TabsContent 
  value="tab-name" 
  forceMount={true} 
  className="data-[state=inactive]:hidden"
>
  {/* Fields */}
</TabsContent>
```

## 2. Zod Validation with FormData

### Problem: `null` vs `undefined` in Optional Fields
`formData.get('key')` returns `null` if the field is missing (e.g., from an unmounted section) or not sent. Zod's `.optional()` expects `undefined`, not `null`. Passing `null` to `z.string().optional()` causes a validation error ("Expected string, received null").

### Solution: Sanitize Inputs
Convert `null` to `undefined` before passing to Zod.

```typescript
// in actions.ts
const rawData = {
  // ...
  optionalField: formData.get('optionalField') || undefined, 
  // ...
};
```
*Note: This also converts empty strings `""` to `undefined`, which is usually desired for optional fields.*

## 3. Popovers & Dialogs (Scroll Issues)

### Problem: Dropdown Not Scrolling inside Modal
When using a `Popover` (like in `Command` or `Select`) inside a `Dialog`, scrolling may break or focus may be trapped incorrectly if the Popover is not aware it's in a modal context.

### Solution: `modal={true}`
Add the `modal={true}` prop to the `Popover` component. This ensures it handles focus and scrolling correctly when nested in another modal.

```tsx
<Popover modal={true} ...>
  {/* Content */}
</Popover>
```

## 4. Dropdown Width & Positioning

### Problem: Popover Width Mismatch
By default, a `PopoverContent` might have a fixed width (e.g., `w-[200px]`) which doesn't match a flexible trigger button width (e.g., `w-full`).

### Solution: Use CSS Variable
Radix UI provides a CSS variable reflecting the trigger's width.

```tsx
<PopoverContent className="w-[--radix-popover-trigger-width]" ...>
  {/* Content matches button width exactly */}
</PopoverContent>
```

## 5. Multi-Select Data Storage

### Problem: Key Collisions
When storing hierarchical data (Categories vs Subtypes) as a flat array strings, collisions can occur if a category and subtype share the same ID (e.g., "apartment").

### Solution: Prefixed Keys
Store values with semantic prefixes to ensure uniqueness and easier parsing.

-   Category: `cat:apartment`
-   Subtype: `sub:apartment`
