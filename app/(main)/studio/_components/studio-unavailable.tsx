import Link from "next/link";
import { CloudOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** The one Studio state shown, inside the app shell, while Studio's database provider is restricted. */
export function StudioUnavailable() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 md:p-10">
      <div>
        <p className="text-sm text-muted-foreground">Studio</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Studio is temporarily unavailable</h1>
      </div>
      <Alert>
        <CloudOff className="h-4 w-4" />
        <AlertTitle>Your Studio content is safe</AlertTitle>
        <AlertDescription>
          Studio can&apos;t reach its database right now, so research, content and jobs are paused. Nothing has been lost.
          The CRM keeps working as usual. Please try Studio again later.
        </AlertDescription>
      </Alert>
      <Link href="/admin" className="text-sm font-medium text-primary hover:underline">Go to the CRM</Link>
    </main>
  );
}
