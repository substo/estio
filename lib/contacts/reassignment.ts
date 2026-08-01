export type ContactAssignmentUpdater = {
  contact: {
    updateMany(args: {
      where: { locationId: string; assignedUserId: string };
      data: { assignedUserId: string; leadAssignedToAgent: string };
    }): Promise<{ count: number }>;
  };
};

/**
 * Atomic assignment-only capability for later offboarding orchestration.
 * It cannot clone Contacts or modify ContactHistory because neither operation
 * is part of the explicit repository contract.
 */
export async function reassignContactsWithinLocation(
  repository: ContactAssignmentUpdater,
  input: { locationId: string; sourceUserId: string; successorUserId: string },
): Promise<{ reassignedCount: number }> {
  if (!input.locationId || !input.sourceUserId || !input.successorUserId) {
    throw new Error('Location, source, and successor are required');
  }
  if (input.sourceUserId === input.successorUserId) {
    throw new Error('Source and successor must be different users');
  }

  const result = await repository.contact.updateMany({
    where: { locationId: input.locationId, assignedUserId: input.sourceUserId },
    data: { assignedUserId: input.successorUserId, leadAssignedToAgent: input.successorUserId },
  });
  return { reassignedCount: result.count };
}
