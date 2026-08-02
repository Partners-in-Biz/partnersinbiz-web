// lib/crm/facts/graph.ts
// Graph-safe CRM neighbour expansion — always return IDs the system already knows.
// Never force agents/humans to paste IDs for linked records.

import { adminDb } from '@/lib/firebase/admin'

export interface CrmGraphNeighbour {
  type: 'company' | 'contact' | 'deal' | 'quote' | 'activity' | 'project' | 'fact' | 'research_task'
  id: string
  label?: string
  rel: string
  meta?: Record<string, unknown>
}

export interface ContactGraphPayload {
  contact: {
    id: string
    orgId: string
    name?: string
    email?: string
    companyId?: string | null
    companyName?: string | null
    dealIds: string[]
    companyIds: string[]
  }
  neighbours: CrmGraphNeighbour[]
}

/**
 * Load a contact-centric graph slice with neighbour IDs always populated.
 * Fail-closed: wrong org → null.
 */
export async function loadContactGraph(args: {
  orgId: string
  contactId: string
  includeFacts?: boolean
  includeResearchTasks?: boolean
  activityLimit?: number
  dealLimit?: number
}): Promise<ContactGraphPayload | null> {
  const snap = await adminDb.collection('contacts').doc(args.contactId).get()
  if (!snap.exists) return null
  const c = snap.data()!
  if (c.orgId !== args.orgId || c.deleted === true) return null

  const neighbours: CrmGraphNeighbour[] = []
  const companyIds = new Set<string>()
  if (typeof c.companyId === 'string' && c.companyId) companyIds.add(c.companyId)
  if (Array.isArray(c.companyLinks)) {
    for (const link of c.companyLinks) {
      if (link && typeof link.companyId === 'string' && link.companyId) {
        companyIds.add(link.companyId)
      }
    }
  }

  for (const companyId of companyIds) {
    neighbours.push({
      type: 'company',
      id: companyId,
      label: typeof c.companyName === 'string' ? c.companyName : undefined,
      rel: companyId === c.companyId ? 'primary_company' : 'linked_company',
    })
  }

  const dealLimit = Math.min(Math.max(args.dealLimit ?? 25, 1), 100)
  const dealsSnap = await adminDb
    .collection('deals')
    .where('orgId', '==', args.orgId)
    .where('contactId', '==', args.contactId)
    .limit(dealLimit)
    .get()

  const dealIds: string[] = []
  for (const d of dealsSnap.docs) {
    const data = d.data()
    if (data.deleted === true) continue
    dealIds.push(d.id)
    neighbours.push({
      type: 'deal',
      id: d.id,
      label: typeof data.title === 'string' ? data.title : undefined,
      rel: 'contact_deal',
      meta: {
        pipelineId: data.pipelineId ?? null,
        stageId: data.stageId ?? null,
        companyId: data.companyId ?? null,
      },
    })
    if (typeof data.companyId === 'string' && data.companyId && !companyIds.has(data.companyId)) {
      companyIds.add(data.companyId)
      neighbours.push({
        type: 'company',
        id: data.companyId,
        label: typeof data.companyName === 'string' ? data.companyName : undefined,
        rel: 'deal_company',
      })
    }
  }

  const activityLimit = Math.min(Math.max(args.activityLimit ?? 10, 1), 50)
  try {
    const actSnap = await adminDb
      .collection('activities')
      .where('contactId', '==', args.contactId)
      .orderBy('createdAt', 'desc')
      .limit(activityLimit)
      .get()
    for (const a of actSnap.docs) {
      const data = a.data()
      if (data.orgId && data.orgId !== args.orgId) continue
      neighbours.push({
        type: 'activity',
        id: a.id,
        label: typeof data.summary === 'string' ? data.summary : data.type,
        rel: 'contact_activity',
        meta: { type: data.type ?? null },
      })
    }
  } catch {
    // Missing composite index must not break graph reads
  }

  if (args.includeFacts !== false) {
    try {
      const factsSnap = await adminDb
        .collection('contact_facts')
        .where('orgId', '==', args.orgId)
        .where('contactId', '==', args.contactId)
        .where('status', '==', 'PROPOSED')
        .limit(30)
        .get()
      for (const f of factsSnap.docs) {
        const data = f.data()
        if (data.deleted === true) continue
        neighbours.push({
          type: 'fact',
          id: f.id,
          label: `${data.field}=${data.value}`,
          rel: 'proposed_fact',
          meta: { field: data.field, band: data.band, status: data.status },
        })
      }
    } catch {
      // index optional
    }
  }

  if (args.includeResearchTasks) {
    try {
      const tasksSnap = await adminDb
        .collection('crm_research_tasks')
        .where('orgId', '==', args.orgId)
        .where('contactId', '==', args.contactId)
        .limit(20)
        .get()
      for (const t of tasksSnap.docs) {
        const data = t.data()
        if (data.deleted === true) continue
        if (data.status === 'done' || data.status === 'cancelled') continue
        neighbours.push({
          type: 'research_task',
          id: t.id,
          label: typeof data.reason === 'string' ? data.reason : data.kind,
          rel: 'open_research',
          meta: { status: data.status, kind: data.kind },
        })
      }
    } catch {
      // optional
    }
  }

  return {
    contact: {
      id: snap.id,
      orgId: args.orgId,
      name: typeof c.name === 'string' ? c.name : undefined,
      email: typeof c.email === 'string' ? c.email : undefined,
      companyId: typeof c.companyId === 'string' ? c.companyId : null,
      companyName: typeof c.companyName === 'string' ? c.companyName : null,
      dealIds,
      companyIds: Array.from(companyIds),
    },
    neighbours,
  }
}

export interface CompanyGraphPayload {
  company: {
    id: string
    orgId: string
    name?: string
    domain?: string | null
    contactIds: string[]
    dealIds: string[]
  }
  neighbours: CrmGraphNeighbour[]
}

export interface DealGraphPayload {
  deal: {
    id: string
    orgId: string
    title?: string
    contactId?: string | null
    companyId?: string | null
    pipelineId?: string | null
    stageId?: string | null
  }
  neighbours: CrmGraphNeighbour[]
}

/**
 * Company-centric graph — contacts and deals always carry ids.
 */
export async function loadCompanyGraph(args: {
  orgId: string
  companyId: string
  contactLimit?: number
  dealLimit?: number
}): Promise<CompanyGraphPayload | null> {
  const snap = await adminDb.collection('companies').doc(args.companyId).get()
  if (!snap.exists) return null
  const company = snap.data()!
  if (company.orgId !== args.orgId || company.deleted === true) return null

  const neighbours: CrmGraphNeighbour[] = []
  const contactIds: string[] = []
  const dealIds: string[] = []

  const contactLimit = Math.min(Math.max(args.contactLimit ?? 50, 1), 100)
  try {
    const contactsSnap = await adminDb
      .collection('contacts')
      .where('orgId', '==', args.orgId)
      .where('companyId', '==', args.companyId)
      .limit(contactLimit)
      .get()
    for (const d of contactsSnap.docs) {
      const data = d.data()
      if (data.deleted === true) continue
      contactIds.push(d.id)
      neighbours.push({
        type: 'contact',
        id: d.id,
        label: typeof data.name === 'string' ? data.name : undefined,
        rel: 'company_contact',
        meta: {
          email: typeof data.email === 'string' ? data.email : null,
          jobTitle: typeof data.jobTitle === 'string' ? data.jobTitle : null,
        },
      })
    }
  } catch {
    // missing index — do not fail graph
  }

  const dealLimit = Math.min(Math.max(args.dealLimit ?? 50, 1), 100)
  try {
    const dealsSnap = await adminDb
      .collection('deals')
      .where('orgId', '==', args.orgId)
      .where('companyId', '==', args.companyId)
      .limit(dealLimit)
      .get()
    for (const d of dealsSnap.docs) {
      const data = d.data()
      if (data.deleted === true) continue
      dealIds.push(d.id)
      neighbours.push({
        type: 'deal',
        id: d.id,
        label: typeof data.title === 'string' ? data.title : undefined,
        rel: 'company_deal',
        meta: {
          contactId: typeof data.contactId === 'string' ? data.contactId : null,
          pipelineId: data.pipelineId ?? null,
          stageId: data.stageId ?? null,
        },
      })
      if (typeof data.contactId === 'string' && data.contactId && !contactIds.includes(data.contactId)) {
        neighbours.push({
          type: 'contact',
          id: data.contactId,
          rel: 'deal_contact',
        })
      }
    }
  } catch {
    // optional
  }

  return {
    company: {
      id: snap.id,
      orgId: args.orgId,
      name: typeof company.name === 'string' ? company.name : undefined,
      domain: typeof company.domain === 'string' ? company.domain : null,
      contactIds,
      dealIds,
    },
    neighbours,
  }
}

/**
 * Deal-centric graph — contact and company neighbours always include ids.
 */
export async function loadDealGraph(args: {
  orgId: string
  dealId: string
}): Promise<DealGraphPayload | null> {
  const snap = await adminDb.collection('deals').doc(args.dealId).get()
  if (!snap.exists) return null
  const deal = snap.data()!
  if (deal.orgId !== args.orgId || deal.deleted === true) return null

  const neighbours: CrmGraphNeighbour[] = []
  const contactId = typeof deal.contactId === 'string' ? deal.contactId : null
  const companyId = typeof deal.companyId === 'string' ? deal.companyId : null

  if (contactId) {
    neighbours.push({
      type: 'contact',
      id: contactId,
      rel: 'deal_contact',
    })
    try {
      const cSnap = await adminDb.collection('contacts').doc(contactId).get()
      if (cSnap.exists) {
        const c = cSnap.data()!
        if (c.orgId === args.orgId && c.deleted !== true) {
          const idx = neighbours.findIndex((n) => n.type === 'contact' && n.id === contactId)
          if (idx >= 0) {
            neighbours[idx] = {
              ...neighbours[idx]!,
              label: typeof c.name === 'string' ? c.name : undefined,
              meta: {
                email: typeof c.email === 'string' ? c.email : null,
                companyId: typeof c.companyId === 'string' ? c.companyId : null,
              },
            }
          }
          if (!companyId && typeof c.companyId === 'string' && c.companyId) {
            neighbours.push({
              type: 'company',
              id: c.companyId,
              label: typeof c.companyName === 'string' ? c.companyName : undefined,
              rel: 'contact_company',
            })
          }
        }
      }
    } catch {
      // keep bare id
    }
  }

  if (companyId) {
    neighbours.push({
      type: 'company',
      id: companyId,
      label: typeof deal.companyName === 'string' ? deal.companyName : undefined,
      rel: 'deal_company',
    })
  }

  return {
    deal: {
      id: snap.id,
      orgId: args.orgId,
      title: typeof deal.title === 'string' ? deal.title : undefined,
      contactId,
      companyId,
      pipelineId: typeof deal.pipelineId === 'string' ? deal.pipelineId : null,
      stageId: typeof deal.stageId === 'string' ? deal.stageId : null,
    },
    neighbours,
  }
}
