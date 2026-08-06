"use client";

import { useState } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export default function InvalidMasterLoginPage() {
  const { sessionId } = useAuth();
  const clerk = useClerk();
  const [busy, setBusy] = useState(false);

  async function exit() {
    setBusy(true);
    await fetch("/api/platform/impersonation/end", { method: "POST" }).catch(() => undefined);
    await clerk.signOut({ sessionId: sessionId || undefined, redirectUrl: "/sign-in" });
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">User session ended</h1>
      <p className="text-muted-foreground">This login expired or the selected user no longer belongs to the location. Sign out before continuing.</p>
      <Button onClick={exit} disabled={busy}>{busy ? "Signing out…" : "Sign out user"}</Button>
    </main>
  );
}
