import type { OffboardingMode, OffboardingResponsibilityCounts } from './offboarding-confirmation';

type CountResult = Promise<{ count: number }>;
export type OffboardingResponsibilityRepository = {
  contact: { updateMany(args: any): CountResult };
  dealContext: { updateMany(args: any): CountResult };
  contactTask: { updateMany(args: any): CountResult };
  viewingSession: { updateMany(args: any): CountResult };
  viewing: { updateMany(args: any): CountResult };
};

type CountRepository = {
  contact: { count(args: any): Promise<number> };
  conversation: { count(args: any): Promise<number> };
  dealContext: { count(args: any): Promise<number> };
  contactTask: { count(args: any): Promise<number> };
  viewingSession: { count(args: any): Promise<number> };
  viewing: { count(args: any): Promise<number> };
};

export function shouldClearUserGlobalPrivateState(otherRoleCount: number, otherConnectionCount: number): boolean {
  return otherRoleCount === 0 && otherConnectionCount === 0;
}

export async function countOffboardingResponsibilities(
  repository: CountRepository,
  input: { locationId: string; sourceUserId: string; viewingCutoff: Date },
): Promise<OffboardingResponsibilityCounts> {
  const { locationId, sourceUserId, viewingCutoff } = input;
  const [assignedContacts, inheritedConversations, activeAssignedDeals, activeUnassignedDeals, openTasks, nonTerminalViewingSessions, futureActionableViewings] = await Promise.all([
    repository.contact.count({ where: { locationId, assignedUserId: sourceUserId } }),
    repository.conversation.count({ where: { locationId, contact: { locationId, assignedUserId: sourceUserId } } }),
    repository.dealContext.count({ where: { locationId, assignedUserId: sourceUserId, stage: { not: 'CLOSED' } } }),
    repository.dealContext.count({ where: { locationId, assignedUserId: null, stage: { not: 'CLOSED' } } }),
    repository.contactTask.count({ where: { locationId, assignedUserId: sourceUserId, deletedAt: null, status: 'open' } }),
    repository.viewingSession.count({ where: { locationId, agentId: sourceUserId, status: { notIn: ['completed', 'expired'] } } }),
    repository.viewing.count({ where: { userId: sourceUserId, date: { gte: viewingCutoff }, status: { notIn: ['completed', 'cancelled', 'canceled', 'no_show'] }, OR: [{ contact: { locationId } }, { property: { locationId } }] } }),
  ]);
  return { assignedContacts, inheritedConversations, activeAssignedDeals, activeUnassignedDeals, openTasks, nonTerminalViewingSessions, futureActionableViewings };
}

export async function applyOffboardingResponsibilityMode(
  repository: OffboardingResponsibilityRepository,
  input: {
    mode: OffboardingMode;
    locationId: string;
    sourceUserId: string;
    successorUserId: string | null;
    taskIds: string[];
    viewingIds: string[];
    viewingCutoff: Date;
  },
) {
  if (input.mode === 'KEEP_ASSIGNED') {
    return { contacts: 0, deals: 0, tasks: 0, viewingSessions: 0, futureViewings: 0 };
  }
  if (!input.successorUserId) throw new Error('Successor is required for TRANSFER');

  const [contacts, deals, tasks, viewingSessions, futureViewings] = await Promise.all([
    repository.contact.updateMany({
      where: { locationId: input.locationId, assignedUserId: input.sourceUserId },
      data: { assignedUserId: input.successorUserId, leadAssignedToAgent: input.successorUserId },
    }),
    repository.dealContext.updateMany({
      where: { locationId: input.locationId, assignedUserId: input.sourceUserId, stage: { not: 'CLOSED' } },
      data: { assignedUserId: input.successorUserId },
    }),
    repository.contactTask.updateMany({
      where: { id: { in: input.taskIds }, locationId: input.locationId, assignedUserId: input.sourceUserId, deletedAt: null, status: 'open' },
      data: { assignedUserId: input.successorUserId },
    }),
    repository.viewingSession.updateMany({
      where: { locationId: input.locationId, agentId: input.sourceUserId, status: { notIn: ['completed', 'expired'] } },
      data: { agentId: input.successorUserId },
    }),
    repository.viewing.updateMany({
      where: {
        id: { in: input.viewingIds }, userId: input.sourceUserId,
        date: { gte: input.viewingCutoff }, status: { notIn: ['completed', 'cancelled', 'canceled', 'no_show'] },
        OR: [{ contact: { locationId: input.locationId } }, { property: { locationId: input.locationId } }],
      },
      data: { userId: input.successorUserId, syncVersion: { increment: 1 } },
    }),
  ]);
  return {
    contacts: contacts.count,
    deals: deals.count,
    tasks: tasks.count,
    viewingSessions: viewingSessions.count,
    futureViewings: futureViewings.count,
  };
}
