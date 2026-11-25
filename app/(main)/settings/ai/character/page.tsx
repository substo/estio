import Link from "next/link";
import { getCharacter } from "@/lib/studio/character";
import { requireSettingsContext } from "../../_components/context";
import { AiTypeNav } from "../_components/ai-type-nav";
import { CharacterCard } from "../_components/character-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI settings: Character" };

export default async function AiCharacterPage() {
  const { locationId } = await requireSettingsContext();
  if (!locationId) return null;
  const character = await getCharacter(locationId).catch(() => null);
  return <main className="max-w-4xl space-y-4">
    <h1 className="text-2xl font-semibold tracking-tight">AI settings</h1>
    <AiTypeNav />
    <p className="text-sm text-muted-foreground">Who appears in your storyboard frames. The frames themselves are drawn on the <Link href="/settings/ai/images" className="text-primary hover:underline">Images</Link> model you choose.</p>
    {character ? <CharacterCard locationId={locationId} photos={character.photos.map(p => ({ n: p.n, role: p.role, url: p.url }))} profile={character.profile} /> : <p className="text-sm text-muted-foreground">You do not have access to this page.</p>}
  </main>;
}
