/**
 * GET /api/v1/crm/reports/pipeline-diagnostics
 * Read-only on-demand CRM pipeline diagnostic for agents.
 * Auth: member+
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import type { Contact, Deal } from '@/lib/crm/types'
import type { Pipeline } from '@/lib/pipelines/types'
import { buildCrmPipelineDiagnostics } from '@/lib/crm/pipeline-diagnostics'
import {
  crmRecordCompanyIds,
  crmRecordContactIds,
  filterCrmRowsForActor,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
  loadContactAssignmentMap,
} from '@/lib/crm/assignment-access'

export const dynamic = 'force-dynamic'

export const GET = withCrmAuth('member', async (_req, ctx) => {
  try {
    const [contactsSnap, dealsSnap, pipelinesSnap] = await Promise.all([
      adminDb.collection('contacts').where('orgId', '==', ctx.orgId).limit(5000).get(),
      adminDb.collection('deals').where('orgId', '==', ctx.orgId).limit(5000).get(),
      adminDb.collection('pipelines').where('orgId', '==', ctx.orgId).limit(500).get(),
    ])

    let contacts = contactsSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as Contact)
      .filter((contact) => contact.deleted !== true)
    let deals = dealsSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as Deal)
      .filter((deal) => deal.deleted !== true)
    const pipelines = pipelinesSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as Pipeline)
      .filter((pipeline) => pipeline.deleted !== true)

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

    return apiSuccess(buildCrmPipelineDiagnostics({ contacts, deals, pipelines }))
  } catch (err) {
    return apiErrorFromException(err)
  }
})
