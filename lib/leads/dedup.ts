import db from '@/lib/db';

export async function findDuplicateContact(
  locationId: string,
  phone: string | null,
  email: string | null
): Promise<{ contactId: string; confidence: number } | null> {
  if (phone) {
    const match = await db.contact.findFirst({
      where: { locationId, phone },
      select: { id: true },
    });
    if (match) return { contactId: match.id, confidence: 1.0 };
  }
  if (email) {
    const match = await db.contact.findFirst({
      where: { locationId, email },
      select: { id: true },
    });
    if (match) return { contactId: match.id, confidence: 1.0 };
  }
  return null;
}
