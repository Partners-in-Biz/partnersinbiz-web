import { adminDb } from '@/lib/firebase/admin'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import { genericChatContextAdapter } from '@/lib/chat-context/adapters/generic'
import type {
  ChatContextAction,
  ChatContextReadModel,
  ChatContextRelationship,
  ContextDisplayState,
} from '@/lib/chat-context/types'
import { resolveBillingCrmAuthContext } from '@/lib/billing/crm-record-scope'
import { resolveContextReferences } from '@/lib/context-references/registry'
import { loadPipeline } from '@/lib/pipelines/store'
import type { PipelineStage } from '@/lib/pipelines/types'
import { ROLE_RANK } from '@/lib/orgMembers/types'

type CrmContextKind = 'contact' | 'company' | 'deal'
type RawDoc = Record<string, unknown>

const CONTACT_STAGE_ORDER = ['new', 'contacted', 'replied', 'demo', 'proposal'] as const

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function dateString(value: unknown): string | undefined {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (value && typeof value === 'object') {
    try {
      const converted = (value as { toDate?: () => Date }).toDate?.()
      if (converted && !Number.isNaN(converted.getTime())) return converted.toISOString()
    } catch {
      return undefined
    }
  }
  return undefined
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function displayName(data: RawDoc, fallback: string): string {
  return clean(data.name, 180)
    || [clean(data.firstName, 80), clean(data.lastName, 80)].filter(Boolean).join(' ')
    || clean(data.title, 180)
    || fallback
}

function actorCanWrite(role: string): boolean {
  return role === 'system' || ROLE_RANK[role as keyof typeof ROLE_RANK] >= ROLE_RANK.member
}

function currentAssignee(kind: CrmContextKind, data: RawDoc): string {
  if (kind === 'deal') return clean(data.ownerUid, 200)
  if (kind === 'company') {
    return clean(data.ownerUid, 200) || clean(data.accountManagerUid, 200) || clean(data.assignedTo, 200)
  }
  return clean(data.assignedTo, 200)
}

function nextContactStage(value: unknown): string | null {
  const stage = clean(value, 40)
  const index = CONTACT_STAGE_ORDER.indexOf(stage as typeof CONTACT_STAGE_ORDER[number])
  return index >= 0 && index < CONTACT_STAGE_ORDER.length - 1 ? CONTACT_STAGE_ORDER[index + 1] : null
}

function nextOpenDealStage(currentStageId: string, stages: PipelineStage[]): PipelineStage | null {
  const ordered = [...stages].sort((left, right) => left.order - right.order)
  const currentIndex = ordered.findIndex((stage) => stage.id === currentStageId)
  if (currentIndex < 0 || ordered[currentIndex].kind !== 'open') return null
  const next = ordered[currentIndex + 1]
  return next?.kind === 'open' ? next : null
}

export function crmChatActions(input: {
  kind: CrmContextKind
  id: string
  data: RawDoc
  actorUid: string
  actorRole: string
  apiRole: string
  nextDealStage?: PipelineStage | null
}): ChatContextAction[] {
  const id = clean(input.id, 200)
  if (!id || !actorCanWrite(input.actorRole)) return []

  const actions: ChatContextAction[] = []
  const apiBase = `/api/v1/crm/${input.kind === 'company' ? 'companies' : `${input.kind}s`}/${encodeURIComponent(id)}`
  const ownerField = input.kind === 'contact' ? 'assignedTo' : 'ownerUid'
  if (input.apiRole !== 'ai' && input.actorUid && currentAssignee(input.kind, input.data) !== input.actorUid) {
    actions.push({
      id: `claim-crm-${input.kind}:${id}`,
      label: 'Assign to me',
      href: apiBase,
      method: 'PATCH',
      requiresApproval: true,
      body: { [ownerField]: input.actorUid },
    })
  }

  if (input.kind === 'contact') {
    const nextStage = nextContactStage(input.data.stage)
    if (nextStage) {
      actions.push({
        id: `advance-crm-contact:${id}:${nextStage}`,
        label: `Move to ${titleCase(nextStage)}`,
        href: apiBase,
        method: 'PATCH',
        requiresApproval: true,
        body: { stage: nextStage },
      })
    }
    if (input.actorRole === 'admin' || input.actorRole === 'owner' || input.actorRole === 'system') {
      actions.push({
        id: `score-crm-contact:${id}`,
        label: 'Refresh lead score',
        href: `${apiBase}/recompute-score`,
        method: 'POST',
        requiresApproval: true,
        body: { includeAi: true },
      })
    }
  }

  if (input.kind === 'deal' && input.nextDealStage) {
    actions.push({
      id: `advance-crm-deal:${id}:${input.nextDealStage.id}`,
      label: `Move to ${input.nextDealStage.label}`,
      href: apiBase,
      method: 'PATCH',
      requiresApproval: true,
      body: {
        pipelineId: clean(input.data.pipelineId, 200),
        stageId: input.nextDealStage.id,
      },
    })
  }

  return actions
}

function stateFor(kind: CrmContextKind, data: RawDoc, currentStage?: PipelineStage): ContextDisplayState {
  if (kind === 'deal') {
    if (currentStage?.kind === 'won') return 'complete'
    if (currentStage?.kind === 'lost') return 'archived'
  }
  if (kind === 'contact' && (data.stage === 'lost' || data.type === 'churned')) return 'archived'
  if (kind === 'contact' && data.stage === 'won') return 'complete'
  if (kind === 'company' && data.lifecycleStage === 'churned') return 'archived'
  return 'ready'
}

async function dealRelationships(
  data: RawDoc,
  input: Parameters<ChatContextAdapter['resolve']>[0],
  orgId: string,
): Promise<ChatContextRelationship[]> {
  const seeds = [
    { type: 'contact' as const, id: clean(data.contactId, 200), relation: 'Contact' },
    { type: 'company' as const, id: clean(data.companyId, 200), relation: 'Company' },
  ].filter((seed) => seed.id)
  const resolved = await Promise.all(seeds.map(async (seed) => {
    const [ref] = await resolveContextReferences([
      { type: seed.type, id: seed.id, orgId, origin: 'manual' },
    ], input.user, orgId)
    return ref
      ? { kind: ref.type, id: ref.id, label: ref.label, relation: seed.relation, ...(ref.href ? { href: ref.href } : {}) }
      : null
  }))
  return resolved.filter((item): item is ChatContextRelationship => Boolean(item))
}

export const crmChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    if (!['contact', 'company', 'deal'].includes(input.kind)) {
      return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported CRM context' }
    }
    const kind = input.kind as CrmContextKind
    const base = await genericChatContextAdapter.resolve(input)
    if (!base.ok) return base

    const collection = kind === 'company' ? 'companies' : `${kind}s`
    const snap = await adminDb.collection(collection).doc(input.id).get()
    if (!snap.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const data = snap.data() ?? {}
    if (data.deleted === true || clean(data.orgId, 200) !== base.model.context.orgId) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const auth = await resolveBillingCrmAuthContext(input.user, base.model.context.orgId)
    const pipeline = kind === 'deal' && clean(data.pipelineId, 200)
      ? await loadPipeline(clean(data.pipelineId, 200), base.model.context.orgId)
      : null
    const stages = pipeline?.data.stages ?? []
    const currentStage = stages.find((stage) => stage.id === clean(data.stageId, 80))
    const nextDealStage = kind === 'deal' ? nextOpenDealStage(clean(data.stageId, 80), stages) : null
    const actions = crmChatActions({
      kind,
      id: snap.id,
      data,
      actorUid: auth.actor.uid,
      actorRole: auth.role,
      apiRole: input.user.role,
      nextDealStage,
    })
    const relationships = kind === 'deal'
      ? await dealRelationships(data, input, base.model.context.orgId)
      : (base.model.relationships ?? [])
    const href = base.model.context.href
    const label = displayName(data, base.model.context.label)
    const assignment = currentAssignee(kind, data)
    const assignmentRef = kind === 'contact'
      ? data.assignedToRef
      : kind === 'deal'
        ? data.ownerRef
        : data.ownerRef ?? data.accountManagerRef ?? data.assignedToRef
    const assigneeLabel = assignmentRef && typeof assignmentRef === 'object' && !Array.isArray(assignmentRef)
      ? clean((assignmentRef as RawDoc).displayName, 120)
      : ''
    const updatedAt = dateString(data.updatedAt)

    const metrics: ChatContextReadModel['pulse']['metrics'] = kind === 'contact'
      ? [
          { id: 'stage', label: 'Stage', value: titleCase(clean(data.stage, 40) || 'new') },
          { id: 'type', label: 'Type', value: titleCase(clean(data.type, 40) || 'lead') },
          ...(number(data.leadScore) !== null ? [{ id: 'lead-score', label: 'Lead score', value: number(data.leadScore)! }] : []),
          ...(number(data.repliesCount) !== null ? [{ id: 'replies', label: 'Replies', value: number(data.repliesCount)! }] : []),
        ]
      : kind === 'company'
        ? [
            { id: 'lifecycle', label: 'Lifecycle', value: titleCase(clean(data.lifecycleStage, 40) || 'Unspecified') },
            ...(clean(data.industry, 80) ? [{ id: 'industry', label: 'Industry', value: clean(data.industry, 80) }] : []),
            ...(clean(data.tier, 40) ? [{ id: 'tier', label: 'Tier', value: titleCase(clean(data.tier, 40)) }] : []),
            ...(number(data.healthScore) !== null ? [{ id: 'health-score', label: 'Health score', value: number(data.healthScore)! }] : []),
          ]
        : [
            { id: 'stage', label: 'Stage', value: currentStage?.label ?? (clean(data.stageId, 80) || 'Unknown') },
            { id: 'value', label: 'Value', value: `${clean(data.currency, 8) || 'ZAR'} ${(number(data.value) ?? 0).toLocaleString('en-ZA')}` },
            ...(number(data.probability) !== null ? [{ id: 'probability', label: 'Probability', value: `${number(data.probability)}%` }] : []),
            ...(dateString(data.expectedCloseDate) ? [{ id: 'close-date', label: 'Expected close', value: dateString(data.expectedCloseDate)!.slice(0, 10) }] : []),
          ]

    const detail = [
      assigneeLabel ? `Owner: ${assigneeLabel}` : assignment ? 'Assigned' : 'Unassigned',
      kind === 'contact' ? clean(data.companyName, 100) || clean(data.company, 100) : '',
      kind === 'company' ? clean(data.domain, 120) || clean(data.website, 120) : '',
      kind === 'deal' ? pipeline?.data.name : '',
    ].filter(Boolean).join(' · ')

    return {
      ok: true,
      model: {
        context: { ...base.model.context, label },
        pulse: {
          label: kind === 'contact' ? 'CRM contact' : kind === 'company' ? 'CRM company' : 'CRM deal',
          metrics,
          headline: kind === 'contact'
            ? clean(data.email, 180) || clean(data.phone, 80) || detail
            : kind === 'company'
              ? clean(data.website, 180) || clean(data.domain, 120) || detail
              : detail,
        },
        groups: [{
          id: 'overview',
          label: 'CRM control',
          items: [{
            id: snap.id,
            label,
            state: stateFor(kind, data, currentStage),
            ...(detail ? { detail } : {}),
            ...(href ? { href } : {}),
            ...(updatedAt ? { updatedAt } : {}),
            ...(actions.length > 0 ? { actions } : {}),
          }],
        }],
        artifacts: [],
        attention: [],
        activity: base.model.activity,
        preview: {
          kind: 'summary',
          text: [label, detail].filter(Boolean).join(' · '),
          status: kind === 'deal'
            ? currentStage?.label ?? clean(data.stageId, 80)
            : clean(kind === 'company' ? data.lifecycleStage : data.stage, 80),
          ...(updatedAt ? { version: updatedAt } : {}),
        },
        ...(relationships.length > 0 ? { relationships } : {}),
        capabilities: ['open', 'preview', ...(actions.length > 0 ? ['inline-actions'] : [])],
        asOf: new Date().toISOString(),
      },
    }
  },
}
