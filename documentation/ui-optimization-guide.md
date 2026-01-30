# Estio UI Optimization Guide

## Quick Reference

| Category | File | Purpose |
|----------|------|---------|
| **CSS Variables** | `app/globals.css` | Color tokens, radii, spacing |
| **Tailwind Config** | `tailwind.config.ts` | Extended theme, animations |
| **Base Components** | `components/ui/` | 37 shadcn/ui components |
| **Utilities** | `lib/utils.ts` | `cn()` for class merging |

---

## 1. Design Tokens (Single Source of Truth)

### Colors — Use CSS Variables
```css
/* globals.css - Theme Colors */
--primary: 240 5.9% 10%;           /* Main actions */
--secondary: 240 4.8% 95.9%;       /* Subtle backgrounds */
--muted: 240 4.8% 95.9%;           /* Disabled states */
--destructive: 0 84.2% 60.2%;      /* Errors, delete actions */
--accent: 240 4.8% 95.9%;          /* Highlights */
```

**Usage in Tailwind:**
```tsx
// ✅ Good - Uses tokens
<div className="bg-primary text-primary-foreground" />
<div className="text-muted-foreground" />

// ❌ Bad - Hardcoded colors
<div className="bg-[#1a1a1a] text-white" />
```

### Feature-Specific Colors
| Feature | Color | Usage |
|---------|-------|-------|
| AI Features | `purple-500/600` | AI buttons, suggestions |
| Send Actions | `blue-600` | Send buttons, CTAs |
| Errors | `destructive` | Alerts, validations |
| Success | `green-500/600` | Confirmations |

---

## 2. Spacing Scale (Compact UI)

Use Tailwind's scale consistently. For compact UIs:

| Size | Class | Use For |
|------|-------|---------|
| XS | `gap-1`, `p-1` | Inline tools, icon groups |
| SM | `gap-1.5`, `p-2` | Toolbars, compact buttons |
| MD | `gap-2`, `p-3` | Standard sections |
| LG | `gap-3`, `p-4` | Cards, dialogs |

**Compact Input Example (from chat-window):**
```tsx
<div className="px-3 py-2">                    {/* Reduced from p-4 */}
  <div className="flex items-center gap-1">     {/* Reduced from gap-2 */}
    <Button className="h-7 text-[11px] px-2">  {/* Smaller touch target */}
```

---

## 3. Reusable UI Components (`components/ui/`)

Always use existing shadcn components before creating custom ones:

| Component | Import | Common Props |
|-----------|--------|--------------|
| Button | `@/components/ui/button` | `size="sm"`, `variant="ghost"` |
| Select | `@/components/ui/select` | `<SelectTrigger className="h-7">` |
| Tooltip | `@/components/ui/tooltip` | Wrap with `<TooltipProvider>` |
| Dialog | `@/components/ui/dialog` | Modal content |

**Compact Select Pattern:**
```tsx
<Select value={value} onValueChange={setValue}>
  <SelectTrigger className="h-7 text-[11px] border-0 bg-slate-50 px-2">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="x" className="text-xs">Label</SelectItem>
  </SelectContent>
</Select>
```

---

## 4. Typography Scale

| Level | Class | Usage |
|-------|-------|-------|
| Label/Meta | `text-[10px]`, `text-[11px]` | Counters, hints |
| Body Small | `text-xs` | Compact UI, dropdowns |
| Body | `text-sm` | Default text |
| Heading | `text-base font-medium` | Section titles |

---

## 5. Inline Toolbar Pattern

Move toolbars **inside** containers (like Slack, WhatsApp):

```
┌─────────────────────────────────────────┐
│ [Input area...]                         │
├─────────────────────────────────────────┤
│ [Channel▾] | [Model▾] [✨AI]  ⌘↵ [Send]│  ← Inline footer
└─────────────────────────────────────────┘
```

**Implementation:**
```tsx
<div className="rounded-xl border">
  <Textarea className="border-0" />
  {/* Inline Toolbar */}
  <div className="flex items-center justify-between px-2 pb-1.5">
    <div className="flex items-center gap-1">
      {/* Controls here */}
    </div>
    <Button size="sm">Send</Button>
  </div>
</div>
```

---

## 6. Tooltips for AI Features

Use tooltips to explain AI features without cluttering UI:

```tsx
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

<TooltipProvider delayDuration={200}>
  <Tooltip>
    <TooltipTrigger asChild>
      <button className="p-1 rounded-full bg-purple-100/60">
        <Sparkles className="w-3 h-3 text-purple-500" />
      </button>
    </TooltipTrigger>
    <TooltipContent>
      <span className="font-medium">AI Feature</span> — Brief explanation
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```

---

## 7. Class Merging with `cn()`

Always use `cn()` for conditional classes:

```tsx
import { cn } from "@/lib/utils";

<Button className={cn(
  "h-7 rounded-lg px-3",
  isActive ? "bg-blue-600" : "bg-slate-100 text-slate-400"
)} />
```

---

## 8. Optimization Checklist

When optimizing any section, verify:

- [ ] **Colors**: Using CSS variables (`text-primary`, `bg-muted`)
- [ ] **Spacing**: Consistent scale, reduced for compact areas
- [ ] **Components**: Using shadcn/ui, not custom recreations
- [ ] **Typography**: Appropriate size (text-xs for compact)
- [ ] **Tooltips**: AI features explained on hover
- [ ] **Labels**: Removed redundant labels (dropdowns are self-explanatory)
- [ ] **Hint text**: Removed or moved to placeholders

---

## 9. File References

| Path | Description |
|------|-------------|
| [tailwind.config.ts](file:///Users/martingreen/Documents/GitHub/IDX/tailwind.config.ts) | Extended theme |
| [globals.css](file:///Users/martingreen/Documents/GitHub/IDX/app/globals.css) | CSS variables |
| [utils.ts](file:///Users/martingreen/Documents/GitHub/IDX/lib/utils.ts) | `cn()` helper |
| [components/ui/](file:///Users/martingreen/Documents/GitHub/IDX/components/ui) | shadcn components |
