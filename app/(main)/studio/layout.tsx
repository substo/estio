import type { ReactNode } from "react";
import { StudioHeader } from "./_components/studio-header";

export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <StudioHeader />
      {children}
    </div>
  );
}
