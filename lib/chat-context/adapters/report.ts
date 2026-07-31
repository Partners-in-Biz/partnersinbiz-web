import type { ChatContextAdapter } from '@/lib/chat-context/access'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'
import { resolveContextReferences } from '@/lib/context-references/registry'
import type { Report, ReportCategory } from '@/lib/reports/types'
import type { ChatContextAction, ChatContextRelationship } from '@/lib/chat-context/types'

interface ReportRecord extends Omit<Report, 'id'> {
  id: string
}

function clean(value: unknown, max = 240): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function asIso(value: unknown): string | undefined {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (value && typeof value === 'object') {
    const toDate = (value as { toDate?: () => Date }).toDate
    if (typeof toDate === 'function') {
      const parsed = toDate()
      return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined
    }
  }
  return undefined
}

function categoryLabel(category: unknown): string {
  const normalized = clean(category, 40)
  if (!normalized) return 'analytics'
  const canonical = normalized.toLowerCase().replace('_', '-')
  return canonical
}

function stateFromStatus(status: unknown) {
  switch (clean(status, 40).toLowerCase()) {
    case 'sent':
    case 'rendered':
      return 'published'
    case 'archived':
      return 'archived'
    case 'draft':
    default:
      return 'ready'
  }
}

function labelFromReport(report: ReportRecord): string {
  const start = clean(report.period?.start)
  const end = clean(report.period?.end)
  const title = clean((report as { title?: string }).title)
  if (title) return title
  if (start && end) return `${start} to ${end} ${categoryLabel((report as Report & { category?: ReportCategory }).category)} report`
  return `Report ${report.id}`
}

function metricsFromReport(report: ReportRecord) {
  const kpis = report.kpis ?? {} as Record<string, number>
  return [
    { id: 'status', label: 'Status', value: clean(report.status, 20) || 'draft' },
    { id: 'category', label: 'Category', value: categoryLabel(report.category) },
    { id: 'period', label: 'Period', value: `${clean(report.period?.start, 40)} - ${clean(report.period?.end, 40)}` },
    { id: 'invoiced-revenue', label: 'Invoiced revenue', value: typeof kpis.invoiced_revenue === 'number' ? kpis.invoiced_revenue : 0 },
    { id: 'sessions', label: 'Sessions', value: typeof kpis.sessions === 'number' ? kpis.sessions : 0 },
    { id: 'users', label: 'Users', value: typeof kpis.users === 'number' ? kpis.users : 0 },
  ].filter((metric) => metric.value).map((metric, index) => ({ ...metric, id: metric.id || `metric-${index}` }))
}

async function buildRelationships(user: ApiUser, report: ReportRecord): Promise<ChatContextRelationship[]> {
  if (!report.propertyId) return []
  const [property] = await resolveContextReferences([
    { type: 'property', id: report.propertyId, orgId: report.orgId, origin: 'manual' },
  ], user, report.orgId)
  if (!property) return []
  return [{ kind: property.type, id: property.id, label: property.label, relation: 'Property', ...(property.href ? { href: property.href } : {}) }]
}

function adminActions(report: ReportRecord, input: { userRole: string }): ChatContextAction[] {
  if (input.userRole !== 'admin') return []
  return [{
    id: `disable-report-link:${report.id}`,
    label: 'Disable public link',
    href: `/api/v1/reports/${encodeURIComponent(report.id)}/share`,
    method: 'DELETE' as const,
    requiresApproval: true,
  }]
}

export const reportChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    if (input.kind !== 'report') return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported report context' }

    const snap = await adminDb.collection('reports').doc(input.id).get()
    if (!snap.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }

    const data = snap.data() ?? {}
    const report = { ...data, id: snap.id } as ReportRecord

    if (!report.orgId) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const expectedOrg = input.user.activeOrgId || input.user.orgId
    if (expectedOrg && report.orgId !== expectedOrg) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    if (expectedOrg && !canAccessOrg(input.user, report.orgId)) {
      return { ok: false, reason: 'forbidden', status: 403, error: 'Context unavailable' }
    }
    if (!expectedOrg && input.user.role === 'client' && !canAccessOrg(input.user, report.orgId)) {
      return { ok: false, reason: 'forbidden', status: 403, error: 'Context unavailable' }
    }

    const asOf = asIso(report.updatedAt)
    const label = labelFromReport(report)
    const actions = adminActions(report, { userRole: input.user.role })
    const relationships = await buildRelationships(input.user, report)
    const href = `/admin/reports/${encodeURIComponent(report.id)}`

    return {
      ok: true,
      model: {
        context: {
          kind: 'report',
          id: report.id,
          orgId: report.orgId,
          label,
          icon: 'analytics',
          href,
        },
        pulse: {
          label: 'Report',
          metrics: metricsFromReport(report),
          headline: [
            clean((report as { exec_summary?: string }).exec_summary, 260),
            `Status: ${clean(report.status, 20) || 'draft'}`,
          ].filter(Boolean).join(' · '),
        },
        groups: [{
          id: 'report',
          label: 'Report',
          items: [{
            id: report.id,
            label,
            state: stateFromStatus(report.status),
            detail: labelFromReport(report),
            href,
            ...(asOf ? { updatedAt: asOf } : {}),
            ...(actions.length ? { actions } : {}),
          }],
        }],
        artifacts: [],
        attention: [],
        activity: [],
        preview: {
          kind: 'summary',
          text: label,
          status: clean(report.status, 20),
        },
        ...(relationships.length ? { relationships } : {}),
        capabilities: ['open', 'preview', ...(actions.length ? ['inline-actions'] : [])],
        asOf: asOf || new Date().toISOString(),
      },
    }
  },
}
