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
    }))
  } catch (err) {
    return apiErrorFromException(err)
  }
})
