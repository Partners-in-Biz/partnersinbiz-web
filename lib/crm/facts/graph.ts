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
