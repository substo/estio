type DeviceState = "Online" | "Offline" | "Awaiting pairing" | "Approval required";

const STATUS_CLASS: Record<DeviceState, string> = {
  Online: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  Offline: "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200",
  "Approval required": "bg-muted text-foreground",
  "Awaiting pairing": "bg-muted text-foreground",
};

export function DeviceStatus({ state }: { state: DeviceState }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[state]}`}>
    <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
    {state}
  </span>;
}
