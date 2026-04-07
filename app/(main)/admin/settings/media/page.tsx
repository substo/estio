import { getLocationContext } from "@/lib/auth/location-context";
import { MediaTrashClient } from "./media-trash-client";

export default async function MediaSettingsPage() {
  const location = await getLocationContext();

  if (!location) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">
          Could not determine your location context. Please try signing out and
          back in.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Media Management</h1>
      <MediaTrashClient locationId={location.id} />
    </div>
  );
}
