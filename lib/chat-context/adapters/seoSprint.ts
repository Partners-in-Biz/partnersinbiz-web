import { adminDb } from '@/lib/firebase/admin'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import type {
  ChatContextAction,
  ChatContextReadModel,
  ContextDisplayState,
  ContextItemSummary,
} from '@/lib/chat-context/types'

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function stateForTask(status: string): ContextDisplayState {
  switch (status) {
    case 'done': return 'complete'
    case 'blocked': return 'blocked'
    case 'in_progress': return 'running'
    case 'skipped':
    case 'na': return 'archived'
    default: return 'ready'
  }
}

export function seoSprintChatActions(input: {
  id: string
  sprint: Record<string, unknown>
  role: string | undefined
}): ChatContextAction[] {
  const id = clean(input.id, 200)
  const status = clean(input.sprint.status, 80)
  const plan = input.sprint.todayPlan && typeof input.sprint.todayPlan === 'object' && !Array.isArray(input.sprint.todayPlan)
    ? input.sprint.todayPlan as Record<string, unknown>
    : {}
  const runnableCount = (Array.isArray(plan.due) ? plan.due.length : 0)
    + (Array.isArray(plan.inProgress) ? plan.inProgress.length : 0)
  const canRun = input.role === 'admin' || input.role === 'ai'
  if (
    !id
    || !canRun
    || !['active', 'compounding'].includes(status)
    || input.sprint.autopilotMode === 'off'
    || runnableCount === 0
  ) return []
  return [{
    id: `run-seo-plan:${id}`,
    label: `Run today's SEO plan`,
    href: `/api/v1/seo/sprints/${encodeURIComponent(id)}/run`,
    method: 'POST',
    requiresApproval: true,
  }]
}

function taskItem(doc: { id: string; data(): Record<string, unknown> }): ContextItemSummary {
  const data = doc.data()
  const status = clean(data.status, 80) || 'not_started'
  return {
    id: doc.id,
    label: clean(data.title, 180) || 'SEO task',
    state: stateForTask(status),
    detail: [
      status.replaceAll('_', ' '),
      clean(data.focus, 80),
      typeof data.week === 'number' ? `week ${data.week}` : '',
    ].filter(Boolean).join(' · '),
  }
}

export const seoSprintChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    const snap = await adminDb.collection('seo_sprints').doc(input.id).get()
    if (!snap.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const data = snap.data() ?? {}
    if (data.deleted === true) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }

    const orgId = clean(data.orgId, 200)
    const expectedOrg = input.user.activeOrgId || input.user.orgId || ''
    if (!orgId || (expectedOrg && orgId !== expectedOrg)) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const taskSnap = await adminDb
      .collection('seo_tasks')
      .where('sprintId', '==', snap.id)
      .where('deleted', '==', false)
      .get()
    const tasks = taskSnap.docs.map(taskItem)
    const done = tasks.filter((task) => task.state === 'complete').length
    const blocked = tasks.filter((task) => task.state === 'blocked').length
    const running = tasks.filter((task) => task.state === 'running').length
    const status = clean(data.status, 80) || 'pre-launch'
    const actions = seoSprintChatActions({ id: snap.id, sprint: data, role: input.user.role })
    const href = `/portal/seo/sprints/${encodeURIComponent(snap.id)}`
    const label = clean(data.siteName, 160) || clean(data.siteUrl, 160) || 'SEO sprint'

    const groups: ChatContextReadModel['groups'] = [{
      id: 'overview',
      label: 'Sprint control',
      items: [{
        id: snap.id,
        label: actions.length > 0 ? 'Today’s plan is ready' : `${label} · ${status.replaceAll('-', ' ')}`,
        state: blocked > 0 ? 'blocked' : running > 0 ? 'running' : 'ready',
        detail: `${done}/${tasks.length} tasks complete${blocked > 0 ? ` · ${blocked} blocked` : ''}`,
        href,
        ...(actions.length > 0 ? { actions } : {}),
      }],
    }]
    if (tasks.length > 0) groups.push({ id: 'tasks', label: 'Tasks', items: tasks.slice(0, 12) })

    return {
      ok: true,
      model: {
        context: {
          kind: 'seo_sprint',
          id: snap.id,
          orgId,
          label,
          icon: 'query_stats',
          href,
        },
        pulse: {
          label: 'SEO sprint',
          progress: { complete: done, total: tasks.length },
          metrics: [
            { id: 'status', label: 'Status', value: status.replaceAll('-', ' ') },
            { id: 'week', label: 'Week', value: typeof data.currentWeek === 'number' ? data.currentWeek : 0 },
            { id: 'running', label: 'In progress', value: running },
            { id: 'blocked', label: 'Blocked', value: blocked },
            { id: 'autopilot', label: 'Autopilot', value: clean(data.autopilotMode, 40) || 'off' },
          ],
          headline: clean(data.siteUrl, 280) || `${tasks.length} SEO tasks`,
        },
        groups,
        artifacts: [],
        attention: [],
        activity: [],
        preview: { kind: 'summary', text: clean(data.siteUrl, 280) || undefined, status },
        capabilities: ['open', 'preview', ...(actions.length > 0 ? ['inline-actions'] : [])],
        asOf: new Date().toISOString(),
      },
    }
  },
}
