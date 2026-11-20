import { getActiveContactsAccess } from "@/lib/contacts/active-location-access";
import { MediaTrashClient } from "./media-trash-client";

export default async function MediaSettingsPage() {
  const access = await getActiveContactsAccess();

  if (!access || access.role !== "ADMIN") {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">
          ADMIN access is required to manage this location&apos;s media trash.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Media Management</h1>
      <MediaTrashClient />
    </div>
  );
}
