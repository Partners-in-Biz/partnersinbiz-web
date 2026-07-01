/**
 * GET /api/v1/agent/growth-command-queue
 * Read-only CEO growth queue gatherer for chat agents.
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiErrorFromException, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import type { Contact, Deal } from '@/lib/crm/types'
import type { Pipeline } from '@/lib/pipelines/types'
import { buildBriefingFeed } from '@/lib/briefing/feed'
import { buildAgentGrowthCommandQueue } from '@/lib/agent/growth-command-queue'
import { buildCrmPipelineDiagnostics } from '@/lib/crm/pipeline-diagnostics'
import { buildSocialContentReadiness } from '@/lib/social/content-readiness'
import { buildSocialFailedPostDiagnostics } from '@/lib/social/failed-post-diagnostics'
import {
  crmRecordCompanyIds,
  crmRecordContactIds,
  filterCrmRowsForActor,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
  loadContactAssignmentMap,
} from '@/lib/crm/assignment-access'

export const dynamic = 'force-dynamic'

function rowsFromSnapshot<T extends Record<string, unknown>>(snap: { docs: Array<{ id: string; data: () => T }> }) {
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

function dateFromUnknown(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date && Number.isFinite(value.getTime())) return value
  if (typeof value === 'number') {
    const date = new Date(value > 10_000_000_000 ? value : value * 1000)
    return Number.isFinite(date.getTime()) ? date : null
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date : null
  }
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate()
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null
  }
  return null
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function conversationIdFromRun(run: Record<string, unknown>): string | null {
  const direct = cleanString(run.conversationId)
  if (direct) return direct
  const prompt = cleanString(run.prompt)
  if (!prompt) return null
  const match = prompt.match(/\bconvId:\s*([A-Za-z0-9_-]+)/)
  return match?.[1] ?? null
}

function completedAssistantText(data: Record<string, unknown>): string | null {
  if (data.role !== 'assistant') return null
  if (data.status === 'failed') return null
  const content = cleanString(data.content) ?? cleanString(data.text) ?? cleanString(data.message)
  if (!content) return null
  if (/^HTTP\s+\d{3}:/i.test(content)) return null
  return content
}

async function agentRunRecoveredAfterFailure(runId: string): Promise<boolean> {
  const runDoc = await adminDb.collection('hermes_runs').doc(runId).get()
  if (!runDoc.exists) return false
  const run = runDoc.data() ?? {}
  const status = cleanString(run.status)?.toLowerCase()
  if (!['failed', 'error', 'errored', 'cancelled', 'canceled'].includes(status ?? '')) return false

  const failedAt = dateFromUnknown(run.updatedAt) ?? dateFromUnknown(run.completedAt) ?? dateFromUnknown(run.createdAt)
  const conversationId = conversationIdFromRun(run)
  if (!failedAt || !conversationId) return false

  const messagesSnap = await adminDb
    .collection('conversations')
    .doc(conversationId)
    .collection('messages')
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get()

  return messagesSnap.docs.some((doc) => {
    const data = doc.data() ?? {}
    if (!completedAssistantText(data)) return false
    const createdAt = dateFromUnknown(data.createdAt)
    return Boolean(createdAt && createdAt.getTime() > failedAt.getTime())
  })
}

async function recoveredAgentRunIdsFromBriefing(items: Awaited<ReturnType<typeof buildBriefingFeed>>['items']): Promise<string[]> {
  const runIds = Array.from(new Set(items
    .filter((item) => item.source.type === 'agent-run')
    .map((item) => item.source.id)
    .filter(Boolean)))

  const settled = await Promise.allSettled(runIds.map(async (runId) => ({
    runId,
    recovered: await agentRunRecoveredAfterFailure(runId),
  })))

  return settled.flatMap((result) =>
    result.status === 'fulfilled' && result.value.recovered ? [result.value.runId] : [],
  )
}

export const GET = withCrmAuth('member', async (_req, ctx) => {
  try {
    const [
      contactsSnap,
      dealsSnap,
      pipelinesSnap,
      socialPostsSnap,
      socialAccountsSnap,
      socialQueueSnap,
    ] = await Promise.all([
      adminDb.collection('contacts').where('orgId', '==', ctx.orgId).limit(5000).get(),
      adminDb.collection('deals').where('orgId', '==', ctx.orgId).limit(5000).get(),
      adminDb.collection('pipelines').where('orgId', '==', ctx.orgId).limit(500).get(),
      adminDb.collection('social_posts').where('orgId', '==', ctx.orgId).limit(5000).get(),
      adminDb.collection('social_accounts').where('orgId', '==', ctx.orgId).limit(500).get(),
      adminDb.collection('social_queue').where('orgId', '==', ctx.orgId).limit(5000).get(),
    ])

    let contacts = rowsFromSnapshot(contactsSnap) as Contact[]
    let deals = rowsFromSnapshot(dealsSnap) as Deal[]
    const pipelines = rowsFromSnapshot(pipelinesSnap) as Pipeline[]

    contacts = contacts.filter((contact) => contact.deleted !== true)
    deals = deals.filter((deal) => deal.deleted !== true)

    if (!isCrmPrivilegedActor(ctx)) {
      const contactCompanyIds = new Set<string>()
      for (const contact of contacts) {
        for (const companyId of crmRecordCompanyIds(contact)) contactCompanyIds.add(companyId)
      }
      const contactCompanies = await loadCompanyAssignmentMap(ctx.orgId, contactCompanyIds)
      contacts = filterCrmRowsForActor(ctx, contacts, { companies: contactCompanies })

      const dealContacts = await loadContactAssignmentMap(ctx.orgId, deals.flatMap((deal) => crmRecordContactIds(deal)))
      const dealCompanyIds = new Set<string>()
      for (const deal of deals) {
        for (const companyId of crmRecordCompanyIds(deal)) dealCompanyIds.add(companyId)
        for (const contactId of crmRecordContactIds(deal)) {
          for (const companyId of crmRecordCompanyIds(dealContacts.get(contactId))) dealCompanyIds.add(companyId)
        }
      }
      const dealCompanies = await loadCompanyAssignmentMap(ctx.orgId, dealCompanyIds)
      deals = filterCrmRowsForActor(ctx, deals, { contacts: dealContacts, companies: dealCompanies })
    }

    const crm = buildCrmPipelineDiagnostics({ contacts, deals, pipelines })
    const social = buildSocialContentReadiness({
      posts: rowsFromSnapshot(socialPostsSnap),
      accounts: rowsFromSnapshot(socialAccountsSnap),
      queueEntries: rowsFromSnapshot(socialQueueSnap),
    })
    const failedSocial = buildSocialFailedPostDiagnostics({
      posts: rowsFromSnapshot(socialPostsSnap),
      accounts: rowsFromSnapshot(socialAccountsSnap),
    })
    const briefingUser: ApiUser = ctx.user?.role === 'admin'
      ? { uid: ctx.user.uid, role: 'admin', allowedOrgIds: ctx.user.allowedOrgIds, orgId: ctx.orgId }
      : ctx.isAgent
        ? { uid: ctx.user?.uid ?? ctx.uid ?? 'agent:pip', role: 'ai', agentId: ctx.user?.agentId, orgId: ctx.orgId }
        : { uid: ctx.uid ?? 'client', role: 'client', orgId: ctx.orgId, orgIds: [ctx.orgId] }
    const briefing = await buildBriefingFeed(briefingUser, {
      orgId: ctx.orgId,
      priority: 'all',
      sourceType: 'all',
      limit: 80,
    })
    const recoveredAgentRunIds = await recoveredAgentRunIdsFromBriefing(briefing.items)

    return apiSuccess(buildAgentGrowthCommandQueue({
      orgId: ctx.orgId,
      crm,
      social,
      failedSocial,
      briefing: {
        generatedAt: briefing.generatedAt,
        total: briefing.total,
        items: briefing.items,
      },
      recoveredAgentRunIds,
    }))
  } catch (err) {
    return apiErrorFromException(err)
  }
})
