"use client"

import Link from "next/link"
import { BriefcaseBusiness, Clapperboard, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export type ProductKey = "crm" | "studio"

/** A product is opened by a plain link or by a server action that first selects its workspace/location. */
export type ProductTarget =
  | { href: string }
  | { action: (formData: FormData) => void | Promise<void>; fields?: Record<string, string> }

const PRODUCTS: { key: ProductKey; label: string; icon: LucideIcon }[] = [
  { key: "crm", label: "CRM", icon: BriefcaseBusiness },
  { key: "studio", label: "Studio", icon: Clapperboard },
]

/**
 * Segmented CRM/Studio switch shown under the logo. Only products with a target are
 * rendered, so a brand without CRM (or Studio) never shows a dead option; with a single
 * product the switch is hidden entirely.
 */
export function ProductSwitcher({
  active,
  targets,
  compact = false,
  className,
}: {
  active: ProductKey
  targets: Partial<Record<ProductKey, ProductTarget>>
  compact?: boolean
  className?: string
}) {
  const products = PRODUCTS.filter((product) => targets[product.key])
  if (products.length < 2) return null

  return (
    <div
      role="group"
      aria-label="Switch product"
      className={cn(
        "rounded-lg border bg-background p-0.5",
        compact ? "flex flex-col gap-0.5" : "grid grid-cols-2 gap-0.5",
        className
      )}
    >
      {products.map(({ key, label, icon: Icon }) => {
        const target = targets[key]!
        const isActive = key === active
        const classes = cn(
          "flex w-full items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors",
          compact ? "h-8" : "h-7 px-2",
          isActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )
        const content = (
          <>
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className={compact ? "sr-only" : undefined}>{label}</span>
          </>
        )
        if (isActive) {
          return <span key={key} aria-current="page" title={compact ? label : undefined} className={classes}>{content}</span>
        }
        if ("href" in target) {
          return <Link key={key} href={target.href} prefetch title={compact ? label : undefined} className={classes}>{content}</Link>
        }
        return (
          <form key={key} action={target.action} className="contents">
            {Object.entries(target.fields ?? {}).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <button type="submit" title={compact ? label : undefined} className={classes}>{content}</button>
          </form>
        )
      })}
    </div>
  )
}
