import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type AssignmentRecoveryCounts = {
  contacts: number;
  inheritedConversations: number;
  deals: number;
  openTasks: number;
  nonTerminalViewingSessions: number;
  futureActionableViewings: number;
};

export type AssignmentRecoveryPayload = {
  confirmationId: string;
  actorUserId: string;
  locationId: string;
  targetUserId: string;
  targetClerkId: string;
  targetEmail: string;
  previewFingerprint: string;
  responsibilityCutoff: string;
  issuedAt: number;
};

type CountRepository = {
  contact: { count(args: any): Promise<number> };
  conversation: { count(args: any): Promise<number> };
  dealContext: { count(args: any): Promise<number> };
  contactTask: { count(args: any): Promise<number> };
  viewingSession: { count(args: any): Promise<number> };
  viewing: { count(args: any): Promise<number> };
};

type UpdateRepository = {
  contact: { updateMany(args: any): Promise<{ count: number }> };
  dealContext: { updateMany(args: any): Promise<{ count: number }> };
  contactTask: { updateMany(args: any): Promise<{ count: number }> };
  viewingSession: { updateMany(args: any): Promise<{ count: number }> };
  viewing: { updateMany(args: any): Promise<{ count: number }> };
};

const MAX_AGE_MS = 15 * 60 * 1000;
const needsTarget = (field: string, targetUserId: string) => ({
  OR: [{ [field]: null }, { [field]: { not: targetUserId } }],
});

export async function countAssignmentRecovery(
  repository: CountRepository,
  input: { locationId: string; targetUserId: string; viewingCutoff: Date },
): Promise<AssignmentRecoveryCounts> {
  const { locationId, targetUserId, viewingCutoff } = input;
  const [contacts, inheritedConversations, deals, openTasks, nonTerminalViewingSessions, futureActionableViewings] = await Promise.all([
    repository.contact.count({ where: { locationId, ...needsTarget('assignedUserId', targetUserId) } }),
    repository.conversation.count({ where: { locationId, contact: { locationId, ...needsTarget('assignedUserId', targetUserId) } } }),
    repository.dealContext.count({ where: { locationId, ...needsTarget('assignedUserId', targetUserId) } }),
    repository.contactTask.count({ where: { locationId, deletedAt: null, status: 'open', ...needsTarget('assignedUserId', targetUserId) } }),
    repository.viewingSession.count({ where: { locationId, agentId: { not: targetUserId }, status: { notIn: ['completed', 'expired'] } } }),
    repository.viewing.count({ where: {
      userId: { not: targetUserId }, date: { gte: viewingCutoff },
      status: { notIn: ['completed', 'cancelled', 'canceled', 'no_show'] },
      OR: [{ contact: { locationId } }, { property: { locationId } }],
    } }),
  ]);
  return { contacts, inheritedConversations, deals, openTasks, nonTerminalViewingSessions, futureActionableViewings };
}

export async function applyAssignmentRecovery(
  repository: UpdateRepository,
  input: { locationId: string; targetUserId: string; taskIds: string[]; viewingIds: string[]; viewingCutoff: Date },
) {
  const { locationId, targetUserId, taskIds, viewingIds, viewingCutoff } = input;
  const [contacts, deals, openTasks, viewingSessions, futureViewings] = await Promise.all([
    repository.contact.updateMany({
      where: { locationId, ...needsTarget('assignedUserId', targetUserId) },
      data: { assignedUserId: targetUserId, leadAssignedToAgent: targetUserId },
    }),
    repository.dealContext.updateMany({
      where: { locationId, ...needsTarget('assignedUserId', targetUserId) },
      data: { assignedUserId: targetUserId },
    }),
    repository.contactTask.updateMany({
      where: { id: { in: taskIds }, locationId, deletedAt: null, status: 'open', ...needsTarget('assignedUserId', targetUserId) },
      data: { assignedUserId: targetUserId },
    }),
    repository.viewingSession.updateMany({
      where: { locationId, agentId: { not: targetUserId }, status: { notIn: ['completed', 'expired'] } },
      data: { agentId: targetUserId },
    }),
    repository.viewing.updateMany({
      where: {
        id: { in: viewingIds }, userId: { not: targetUserId }, date: { gte: viewingCutoff },
        status: { notIn: ['completed', 'cancelled', 'canceled', 'no_show'] },
        OR: [{ contact: { locationId } }, { property: { locationId } }],
      },
      data: { userId: targetUserId, syncVersion: { increment: 1 } },
    }),
  ]);
  return {
    contacts: contacts.count,
    deals: deals.count,
    openTasks: openTasks.count,
    nonTerminalViewingSessions: viewingSessions.count,
    futureActionableViewings: futureViewings.count,
  };
}

export function createAssignmentRecoveryFingerprint(input: {
  locationId: string; targetUserId: string; counts: AssignmentRecoveryCounts;
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('base64url');
}

function secret(): string {
  return String(process.env.OFFBOARDING_CONFIRMATION_SECRET || '').trim();
}

export function createAssignmentRecoveryToken(payload: AssignmentRecoveryPayload): string | null {
  const key = secret();
  if (key.length < 32) return null;
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${createHmac('sha256', key).update(`assignment-recovery:${encoded}`).digest('base64url')}`;
}

export function verifyAssignmentRecoveryToken(token: string, now = Date.now()): AssignmentRecoveryPayload {
  const key = secret();
  if (key.length < 32) throw new Error('Assignment recovery is not configured');
  const [encoded, signature, extra] = String(token || '').split('.');
  if (!encoded || !signature || extra) throw new Error('Invalid recovery confirmation');
  const expected = createHmac('sha256', key).update(`assignment-recovery:${encoded}`).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error('Invalid recovery confirmation');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AssignmentRecoveryPayload;
  if (!payload.confirmationId || !payload.actorUserId || !payload.locationId || !payload.targetUserId || !payload.targetClerkId || !payload.targetEmail || !payload.previewFingerprint || !Number.isFinite(Date.parse(payload.responsibilityCutoff))) {
    throw new Error('Invalid recovery confirmation');
  }
  if (!Number.isFinite(payload.issuedAt) || now - payload.issuedAt > MAX_AGE_MS || payload.issuedAt > now + 60_000) {
    throw new Error('Recovery preview expired; build a new preview');
  }
  return payload;
}

export function requiredAssignmentRecoveryPhrase(email: string): string {
  return `ASSIGN ALL RESPONSIBILITIES TO ${email.trim().toLowerCase()}`;
}
