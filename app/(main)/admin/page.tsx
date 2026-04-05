import { GlobalAiUsageWidget } from "./_components/global-ai-usage-widget";

export default function Dashboard() {
  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome to the Estio Dashboard.</p>
      </div>

      <GlobalAiUsageWidget />
    </div>
  );
}