export function buildTaskReminderDeepLink(args: {
  taskId: string;
  conversationId?: string | null;
}) {
  const params = new URLSearchParams();
  params.set('view', 'tasks');
  params.set('task', args.taskId);

  const conversationId = String(args.conversationId || '').trim();
  if (conversationId) {
    params.set('id', conversationId);
  }

  return `/admin/conversations?${params.toString()}`;
}
