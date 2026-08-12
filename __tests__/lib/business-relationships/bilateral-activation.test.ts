/**
 * Bilateral activation contract for business relationships (P1 cross-org
 * hardening).
 *
 * Proves:
 *  1. Generic CRM relationship creation defaults to inert metadata — pending,
 *     draft, private, portalVisible=false, zero capabilities, no partnerLinkId.
 *  2. No caller may activate a relationship (active/approved/portal-visible/
 *     capabilities/partnerLinkId) without the internal bilateral flag used
 *     only by the accepted partner-invite flow.
 *  3. Unilateral relationship rows — even ones carrying activation fields or a
 *     forged partnerLinkId — grant NO resource access through shares, project
 *     grants, relationship threads or per-partner overviews.
 *  4. The accepted bilateral accept flow still creates working links (both
 *     sides live), and one-side revocation closes the surface.
 */

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn(), runTransaction: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

jest.mock('@/lib/crm/audit', () => ({
  recordCrmAuditEvent: jest.fn(),
}))

import { adminDb } from '@/lib/firebase/admin'
import { createBusinessRelationship, ensureBusinessRelationship, updateBusinessRelationship } from '@/lib/business-relationships/store'
import { sharePartnerRecord } from '@/lib/partner-links/shares'
import { grantPartnerProjectAccess, revokePartnerProjectAccess, revokeProjectAccessForPartnerLink, postPartnerMessage, loadPartnerOverview } from '@/lib/partner-links/collaboration'
import { loadLiveBilateralLink } from '@/lib/partner-links/link-evidence'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

const mockCollection = adminDb.collection as jest.Mock
const mockRunTransaction = adminDb.runTransaction as jest.Mock

type Row = { id: string; data: Record<string, unknown> }

/** Stateful in-memory Firestore mock so writes are visible to later reads. */
function createMemoryDb(seed: Record<string, Row[]> = {}) {
  const store: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(seed)) {
    store[name] = rows.map((r) => ({ id: r.id, data: { ...r.data } }))
  }

  const refFor = (name: string, id: string) => {
    const rows = store[name] ?? (store[name] = [])
    const find = () => rows.find((r) => r.id === id)
    return {
      id,
      get: async () => {
        const row = find()
        return row
          ? { exists: true, id, data: () => row.data, ref: refFor(name, id) }
          : { exists: false, id, data: () => undefined, ref: refFor(name, id) }
      },
      set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
        const row = find()
        if (row) row.data = opts?.merge ? { ...row.data, ...data } : { ...data }
        else rows.push({ id, data: { ...data } })
      },
      update: async (data: Record<string, unknown>) => {
        const row = find()
        if (row) row.data = { ...row.data, ...data }
      },
    }
  }

  const collection = (name: string) => {
    const rows = store[name] ?? (store[name] = [])
    const makeQuery = (filters: Array<[string, unknown]>, limitN?: number) => ({
      where: (field: string, _op: string, value: unknown) => makeQuery([...filters, [field, value]], limitN),
      limit: (n: number) => makeQuery(filters, n),
      get: async () => {
        let docs = rows.filter((r) => filters.every(([f, v]) => r.data[f] === v))
        if (typeof limitN === 'number') docs = docs.slice(0, limitN)
        return {
          docs: docs.map((r) => ({ id: r.id, data: () => r.data, ref: refFor(name, r.id) })),
          empty: docs.length === 0,
          size: docs.length,
        }
      },
    })
    return {
      add: async (data: Record<string, unknown>) => {
        const id = `auto-${rows.length + 1}`
        rows.push({ id, data: { ...data } })
        return { id, get: async () => ({ exists: true, id, data: () => data }) }
      },
      doc: (id: string) => refFor(name, id),
      where: (field: string, op: string, value: unknown) => makeQuery([[field, value]]),
      limit: (n: number) => makeQuery([], n),
      get: async () => ({
        docs: rows.map((r) => ({ id: r.id, data: () => r.data, ref: refFor(name, r.id) })),
        empty: rows.length === 0,
        size: rows.length,
      }),
    }
  }

  let transactionCalls = 0
  const runTransaction = async <T>(callback: (tx: {
    set: (ref: ReturnType<typeof refFor>, data: Record<string, unknown>, opts?: { merge?: boolean }) => Promise<void>
    update: (ref: ReturnType<typeof refFor>, data: Record<string, unknown>) => Promise<void>
  }) => Promise<T>): Promise<T> => {
    transactionCalls += 1
    return callback({
      set: (ref, data, opts) => ref.set(data, opts),
      update: (ref, data) => ref.update(data),
    })
  }

  return { collection, runTransaction, store, rows: (name: string) => store[name] ?? [], transactionCalls: () => transactionCalls }
}

const actor: MemberRef = { uid: 'user:tester', displayName: 'Tester', kind: 'human' }

function relationRow(overrides: Record<string, unknown>): Row {
  return {
    id: String(overrides.id ?? 'rel'),
    data: {
      sourceOrgId: 'org-a',
      targetOrgId: 'org-b',
      relationshipType: 'partner',
      status: 'active',
      approvalState: 'approved',
      portalVisible: true,
      sharedCapabilities: ['crm', 'projects'],
      deleted: false,
      ...overrides,
    },
  }
}

let db: ReturnType<typeof createMemoryDb>

beforeEach(() => {
  jest.clearAllMocks()
  db = createMemoryDb()
  mockCollection.mockImplementation(db.collection)
  mockRunTransaction.mockImplementation((callback) => db.runTransaction(callback))
})

describe('generic business relationship creation is inert metadata', () => {
  it('defaults to pending, draft, private, not portal-visible, no capabilities', async () => {
    const rel = await createBusinessRelationship('org-a', {
      sourceCompanyId: 'company-a',
      targetOrgId: 'org-b',
      targetName: 'Beta',
      relationshipType: 'customer',
    }, actor)

    expect(rel.status).toBe('pending')
    expect(rel.approvalState).toBe('draft')
    expect(rel.portalVisible).toBe(false)
    expect(rel.visibility).toBe('private')
    expect(rel.sharedCapabilities ?? []).toEqual([])
    expect(rel.partnerLinkId).toBeUndefined()
  })

  it('rejects any activation attempt without bilateral evidence', async () => {
    await expect(createBusinessRelationship('org-a', { status: 'active' }, actor))
      .rejects.toThrow(/accepted bilateral Partner Link evidence/)
    await expect(createBusinessRelationship('org-a', { approvalState: 'approved' }, actor))
      .rejects.toThrow(/accepted bilateral Partner Link evidence/)
    await expect(createBusinessRelationship('org-a', { portalVisible: true }, actor))
      .rejects.toThrow(/accepted bilateral Partner Link evidence/)
    await expect(createBusinessRelationship('org-a', { sharedCapabilities: ['projects'] }, actor))
      .rejects.toThrow(/accepted bilateral Partner Link evidence/)
  })

  it('rejects a client-supplied partnerLinkId (server-set-only)', async () => {
    await expect(createBusinessRelationship('org-a', {
      sourceCompanyId: 'company-a',
      targetOrgId: 'org-b',
      partnerLinkId: 'forged-link',
    }, actor)).rejects.toThrow(/server-side only/)
  })

  it('update cannot activate a metadata row', async () => {
    db = createMemoryDb({
      businessRelationships: [relationRow({ id: 'rel-meta', status: 'pending', approvalState: 'draft', portalVisible: false, sharedCapabilities: [] })],
    })
    mockCollection.mockImplementation(db.collection)

    await expect(updateBusinessRelationship('org-a', 'rel-meta', { status: 'active' }, actor))
      .rejects.toThrow(/accepted bilateral Partner Link evidence/)
    await expect(updateBusinessRelationship('org-a', 'rel-meta', { portalVisible: true }, actor))
      .rejects.toThrow(/accepted bilateral Partner Link evidence/)
    await expect(updateBusinessRelationship('org-a', 'rel-meta', { sharedCapabilities: ['projects'] }, actor))
      .rejects.toThrow(/accepted bilateral Partner Link evidence/)
    // A client attempting to mint a partnerLinkId on an existing row is rejected.
    await expect(updateBusinessRelationship('org-a', 'rel-meta', { partnerLinkId: 'forged' }, actor))
      .rejects.toThrow(/server-side only/)
    // Lifecycle statuses remain available.
    await updateBusinessRelationship('org-a', 'rel-meta', { status: 'revoked' }, actor)
    expect(db.rows('businessRelationships')[0].data.status).toBe('revoked')
  })

  it('ensure downgrades a legacy unilateral active row to metadata', async () => {
    db = createMemoryDb({
      businessRelationships: [relationRow({
        id: 'rel-legacy',
        sourceCompanyId: 'company-a',
        relationshipType: 'customer',
        status: 'active',
        approvalState: 'approved',
        portalVisible: true,
        sharedCapabilities: ['crm', 'projects', 'documents', 'services'],
      })],
    })
    mockCollection.mockImplementation(db.collection)

    await ensureBusinessRelationship('org-a', {
      sourceCompanyId: 'company-a',
      targetOrgId: 'org-b',
      relationshipType: 'customer',
    }, actor)

    const row = db.rows('businessRelationships')[0].data
    expect(row.status).toBe('pending')
    expect(row.approvalState).toBe('draft')
    expect(row.portalVisible).toBe(false)
    expect(row.sharedCapabilities ?? []).toEqual([])
    expect(row.partnerLinkId).toBeUndefined()
  })

  it('ensure never downgrades an accepted link row during generic reconcile', async () => {
    db = createMemoryDb({
      businessRelationships: [relationRow({
        id: 'rel-link',
        sourceCompanyId: 'company-a',
        partnerLinkId: 'link-1',
        status: 'active',
        approvalState: 'approved',
        portalVisible: true,
        sharedCapabilities: ['projects', 'documents'],
      })],
    })
    mockCollection.mockImplementation(db.collection)

    await ensureBusinessRelationship('org-a', {
      sourceCompanyId: 'company-a',
      targetOrgId: 'org-b',
      relationshipType: 'partner',
      notes: 'reconciled',
    }, actor)

    const row = db.rows('businessRelationships')[0].data
    expect(row.status).toBe('active')
    expect(row.approvalState).toBe('approved')
    expect(row.portalVisible).toBe(true)
    expect(row.sharedCapabilities).toEqual(['projects', 'documents'])
    expect(row.partnerLinkId).toBe('link-1')
    expect(row.notes).toBe('reconciled')
  })
})

describe('accepted bilateral Partner Link activation (internal flag only)', () => {
  it('create with bilateral evidence preserves activation fields', async () => {
    const rel = await createBusinessRelationship('org-a', {
      sourceCompanyId: 'company-a',
      targetOrgId: 'org-b',
      relationshipType: 'partner',
      status: 'active',
      approvalState: 'approved',
      portalVisible: true,
      sharedCapabilities: ['projects', 'documents'],
      partnerLinkId: 'link-2',
    }, actor, { bilateral: true })

    expect(rel.status).toBe('active')
    expect(rel.approvalState).toBe('approved')
    expect(rel.portalVisible).toBe(true)
    expect(rel.sharedCapabilities).toEqual(['projects', 'documents'])
    expect(rel.partnerLinkId).toBe('link-2')
  })

  it('bilateral activation requires a partnerLinkId', async () => {
    await expect(createBusinessRelationship('org-a', {
      status: 'active',
    }, actor, { bilateral: true })).rejects.toThrow(/partnerLinkId/)
  })

  it('ensure used by the accept flow writes both sides as live links', async () => {
    const linkId = 'link-accept'
    const a = await ensureBusinessRelationship('org-a', {
      sourceCompanyId: 'company-a',
      targetOrgId: 'org-b',
      relationshipType: 'partner',
      status: 'active',
      approvalState: 'approved',
      portalVisible: true,
      sharedCapabilities: ['orders', 'inventory'],
      partnerLinkId: linkId,
    }, actor, { bilateral: true })

    const b = await ensureBusinessRelationship('org-b', {
      sourceCompanyId: 'company-b',
      targetOrgId: 'org-a',
      relationshipType: 'partner',
      status: 'active',
      approvalState: 'approved',
      portalVisible: true,
      sharedCapabilities: ['orders', 'inventory'],
      partnerLinkId: linkId,
    }, actor, { bilateral: true })

    expect(a.status).toBe('active')
    expect(b.status).toBe('active')
    expect(a.partnerLinkId).toBe(linkId)
    expect(b.partnerLinkId).toBe(linkId)

    const evidence = await loadLiveBilateralLink(a.id, 'org-a')
    expect(evidence.link.id).toBe(a.id)
    expect(evidence.counterpart.id).toBe(b.id)
  })

  it('update keeps one-sided capability edits on an accepted link', async () => {
    db = createMemoryDb({
      businessRelationships: [relationRow({
        id: 'rel-link',
        partnerLinkId: 'link-3',
        status: 'active',
        sharedCapabilities: ['projects'],
      })],
    })
    mockCollection.mockImplementation(db.collection)

    const rel = await updateBusinessRelationship('org-a', 'rel-link', { sharedCapabilities: ['projects', 'documents'] }, actor)
    expect(rel.sharedCapabilities).toEqual(['projects', 'documents'])
  })
})

describe('unilateral relationship rows grant no resource access', () => {
  it('a plain metadata row (even if manually stamped active) cannot share records', async () => {
    db = createMemoryDb({
      businessRelationships: [relationRow({
        id: 'rel-u',
        status: 'active',
        approvalState: 'approved',
        portalVisible: true,
        sharedCapabilities: ['crm'],
      })],
      deals: [{ id: 'deal-1', data: { orgId: 'org-a', title: 'Big Deal', deleted: false } }],
    })
    mockCollection.mockImplementation(db.collection)

    await expect(sharePartnerRecord({
      ownerOrgId: 'org-a',
      relationshipId: 'rel-u',
      resourceType: 'deal',
      resourceId: 'deal-1',
      actor,
    })).rejects.toThrow(/not an accepted partner link/)
    expect(db.rows('partner_record_shares')).toHaveLength(0)
  })

  it('a forged partnerLinkId with no counterpart grants no project access', async () => {
    db = createMemoryDb({
      businessRelationships: [relationRow({
        id: 'rel-f',
        partnerLinkId: 'forged-1',
        status: 'active',
        approvalState: 'approved',
        sharedCapabilities: ['projects'],
      })],
      projects: [{ id: 'proj-1', data: { orgId: 'org-a', name: 'Website', deleted: false } }],
    })
    mockCollection.mockImplementation(db.collection)

    await expect(grantPartnerProjectAccess({
      ownerOrgId: 'org-a',
      relationshipId: 'rel-f',
      projectId: 'proj-1',
      role: 'contributor',
      actor,
    })).rejects.toThrow(/not active/)
    expect(db.rows('projectOrganizations')).toHaveLength(0)
  })

  it('a forged partnerLinkId with no counterpart cannot post relationship messages', async () => {
    db = createMemoryDb({
      businessRelationships: [relationRow({
        id: 'rel-f',
        partnerLinkId: 'forged-2',
        status: 'active',
        sharedCapabilities: ['projects'],
      })],
    })
    mockCollection.mockImplementation(db.collection)

    await expect(postPartnerMessage({
      relationshipId: 'rel-f',
      orgId: 'org-a',
      body: 'hello',
      actor,
    })).rejects.toThrow(/not active/)
    expect(db.rows('partner_link_messages')).toHaveLength(0)
  })

  it('a forged partnerLinkId with no counterpart cannot load the partner overview', async () => {
    db = createMemoryDb({
      businessRelationships: [relationRow({
        id: 'rel-f',
        partnerLinkId: 'forged-3',
        status: 'active',
        sharedCapabilities: ['projects'],
      })],
      organizations: [{ id: 'org-b', data: { name: 'Beta' } }],
    })
    mockCollection.mockImplementation(db.collection)

    await expect(loadPartnerOverview({ orgId: 'org-a', relationshipId: 'rel-f' }))
      .rejects.toThrow(/not active/)
  })

  it('when one side revokes, the surviving side loses capability access', async () => {
    db = createMemoryDb({
      businessRelationships: [
        relationRow({ id: 'rel-a', partnerLinkId: 'link-x', status: 'active', sharedCapabilities: ['projects'] }),
        relationRow({ id: 'rel-b', partnerLinkId: 'link-x', status: 'revoked', sourceOrgId: 'org-b', targetOrgId: 'org-a', sharedCapabilities: ['projects'] }),
      ],
      projects: [{ id: 'proj-1', data: { orgId: 'org-a', name: 'Website', deleted: false } }],
    })
    mockCollection.mockImplementation(db.collection)

    await expect(grantPartnerProjectAccess({
      ownerOrgId: 'org-a',
      relationshipId: 'rel-a',
      projectId: 'proj-1',
      role: 'contributor',
      actor,
    })).rejects.toThrow(/not active/)
    expect(db.rows('projectOrganizations')).toHaveLength(0)
  })
})

describe('accepted bilateral links keep working', () => {
  it('sharePartnerRecord works when both sides are live and the capability is shared', async () => {
    db = createMemoryDb({
      businessRelationships: [
        relationRow({ id: 'rel-a', partnerLinkId: 'link-y', status: 'active', sharedCapabilities: ['crm'] }),
        relationRow({ id: 'rel-b', partnerLinkId: 'link-y', sourceOrgId: 'org-b', targetOrgId: 'org-a', status: 'active', sharedCapabilities: ['crm'] }),
      ],
      deals: [{ id: 'deal-1', data: { orgId: 'org-a', title: 'Big Deal', deleted: false } }],
    })
    mockCollection.mockImplementation(db.collection)

    const share = await sharePartnerRecord({
      ownerOrgId: 'org-a',
      relationshipId: 'rel-a',
      resourceType: 'deal',
      resourceId: 'deal-1',
      actor,
    })
    expect(share.status).toBe('active')
    expect(share.partnerOrgId).toBe('org-b')
    expect(share.partnerLinkId).toBe('link-y')
  })

  it('grantPartnerProjectAccess works when both sides are live', async () => {
    db = createMemoryDb({
      partnerLinks: [{ id: 'link-z', data: { partnerLinkId: 'link-z', orgA: 'org-a', orgB: 'org-b', status: 'active' } }],
      partnerScopeAgreements: [{ id: 'scope-z', data: {
        partnerLinkId: 'link-z', status: 'active', capabilities: ['projects'],
        direction: { grantorOrgId: 'org-a', granteeOrgId: 'org-b' },
        acceptance: { grantor: { byRef: actor }, grantee: { byRef: actor } },
      } }],
      businessRelationships: [
        relationRow({ id: 'rel-a', partnerLinkId: 'link-z', status: 'active', sharedCapabilities: ['projects'] }),
        relationRow({ id: 'rel-b', partnerLinkId: 'link-z', sourceOrgId: 'org-b', targetOrgId: 'org-a', status: 'active', sharedCapabilities: ['projects'] }),
      ],
      projects: [{ id: 'proj-1', data: { ownerOrgId: 'org-a', orgId: 'org-a', name: 'Website', deleted: false } }],
      projectMembers: [{ id: 'proj-1_user:tester', data: { uid: 'user:tester', orgId: 'org-a', role: 'manager', status: 'active' } }],
    })
    mockCollection.mockImplementation(db.collection)

    const grant = await grantPartnerProjectAccess({
      ownerOrgId: 'org-a',
      relationshipId: 'rel-a',
      projectId: 'proj-1',
      role: 'contributor',
      actor,
    })
    expect(grant.orgId).toBe('org-b')
    expect(grant.partnerLinkId).toBe('link-z')
    const orgRow = db.rows('projectOrganizations')[0]?.data
    expect(orgRow.orgId).toBe('org-b')
    expect(orgRow.status).toBe('active')
    expect(orgRow.partnerLinkId).toBe('link-z')
    const resourceGrant = db.rows('partnerResourceGrants')[0]?.data
    expect(resourceGrant).toEqual(expect.objectContaining({
      ownerOrgId: 'org-a',
      resourceType: 'project',
      resourceId: 'proj-1',
      partnerLinkId: 'link-z',
      grantee: expect.objectContaining({ orgIds: ['org-b'] }),
      role: 'contributor',
      actions: ['project.read', 'project.write'],
      status: 'active',
      scopeAgreementId: 'scope-z',
      approvalBasis: { type: 'scope_agreement', refId: 'scope-z' },
    }))
    expect(mockRunTransaction).toHaveBeenCalledTimes(1)
  })

  it('requires normal internal project-manager authority before granting cross-org access', async () => {
    db = createMemoryDb({
      partnerLinks: [{ id: 'link-authority', data: { partnerLinkId: 'link-authority', orgA: 'org-a', orgB: 'org-b', status: 'active' } }],
      partnerScopeAgreements: [{ id: 'scope-authority', data: {
        partnerLinkId: 'link-authority', status: 'active', capabilities: ['projects'],
        direction: { grantorOrgId: 'org-a', granteeOrgId: 'org-b' },
        acceptance: { grantor: { byRef: actor }, grantee: { byRef: actor } },
      } }],
      projects: [{ id: 'proj-1', data: { ownerOrgId: 'org-a', orgId: 'legacy-org', name: 'Website', deleted: false } }],
      businessRelationships: [
        relationRow({ id: 'rel-a', partnerLinkId: 'link-authority', status: 'active', sharedCapabilities: ['projects'] }),
        relationRow({ id: 'rel-b', partnerLinkId: 'link-authority', sourceOrgId: 'org-b', targetOrgId: 'org-a', status: 'active', sharedCapabilities: ['projects'] }),
      ],
    })
    mockCollection.mockImplementation(db.collection)

    await expect(grantPartnerProjectAccess({
      ownerOrgId: 'org-a', relationshipId: 'rel-a', projectId: 'proj-1', actor,
    })).rejects.toThrow(/project manager access/i)
    expect(db.rows('partnerResourceGrants')).toHaveLength(0)
  })

  it('does not materialize a project projection or grant without an active bilateral project scope agreement', async () => {
    db = createMemoryDb({
      partnerLinks: [{ id: 'link-no-scope', data: { partnerLinkId: 'link-no-scope', orgA: 'org-a', orgB: 'org-b', status: 'active' } }],
      businessRelationships: [
        relationRow({ id: 'rel-a', partnerLinkId: 'link-no-scope', status: 'active', sharedCapabilities: ['projects'] }),
        relationRow({ id: 'rel-b', partnerLinkId: 'link-no-scope', sourceOrgId: 'org-b', targetOrgId: 'org-a', status: 'active', sharedCapabilities: ['projects'] }),
      ],
      projects: [{ id: 'proj-1', data: { orgId: 'org-a', name: 'Website', deleted: false } }],
    })
    mockCollection.mockImplementation(db.collection)

    await expect(grantPartnerProjectAccess({
      ownerOrgId: 'org-a',
      relationshipId: 'rel-a',
      projectId: 'proj-1',
      role: 'contributor',
      actor,
    })).rejects.toThrow(/scope agreement/i)

    expect(db.rows('partnerResourceGrants')).toHaveLength(0)
    expect(db.rows('projectOrganizations')).toHaveLength(0)
  })

  it('revokes the canonical project grant together with its project-organisation projection', async () => {
    db = createMemoryDb({
      partnerLinks: [{ id: 'link-revoke', data: { partnerLinkId: 'link-revoke', orgA: 'org-a', orgB: 'org-b', status: 'active' } }],
      partnerScopeAgreements: [{ id: 'scope-revoke', data: {
        partnerLinkId: 'link-revoke', status: 'active', capabilities: ['projects'],
        direction: { grantorOrgId: 'org-a', granteeOrgId: 'org-b' },
        acceptance: { grantor: { byRef: actor }, grantee: { byRef: actor } },
      } }],
      businessRelationships: [
        relationRow({ id: 'rel-a', partnerLinkId: 'link-revoke', status: 'active', sharedCapabilities: ['projects'] }),
        relationRow({ id: 'rel-b', partnerLinkId: 'link-revoke', sourceOrgId: 'org-b', targetOrgId: 'org-a', status: 'active', sharedCapabilities: ['projects'] }),
      ],
      projects: [{ id: 'proj-1', data: { ownerOrgId: 'org-a', orgId: 'org-a', name: 'Website', deleted: false } }],
      projectMembers: [{ id: 'proj-1_user:tester', data: { uid: 'user:tester', orgId: 'org-a', role: 'manager', status: 'active' } }],
    })
    mockCollection.mockImplementation(db.collection)
    await grantPartnerProjectAccess({ ownerOrgId: 'org-a', relationshipId: 'rel-a', projectId: 'proj-1', actor })

    await revokePartnerProjectAccess({ ownerOrgId: 'org-a', projectId: 'proj-1', partnerOrgId: 'org-b', actor })

    expect(db.rows('projectOrganizations')[0]?.data.status).toBe('revoked')
    expect(db.rows('partnerResourceGrants')[0]?.data.status).toBe('revoked')
  })

  it('revokes matching canonical project grants when a partner link is unlinked', async () => {
    db = createMemoryDb({
      projectOrganizations: [{ id: 'proj-1_org-b', data: {
        projectId: 'proj-1', orgId: 'org-b', ownerOrgId: 'org-a', partnerLinkId: 'link-unlink', status: 'active',
      } }],
      partnerResourceGrants: [{ id: 'proj-1_org-b', data: {
        ownerOrgId: 'org-a', resourceType: 'project', resourceId: 'proj-1', partnerLinkId: 'link-unlink', status: 'active',
        grantee: { orgIds: ['org-b'], userIds: [], teamIds: [] }, actions: ['project.read'],
      } }],
    })
    mockCollection.mockImplementation(db.collection)

    await revokeProjectAccessForPartnerLink({ partnerLinkId: 'link-unlink', actor })

    expect(db.rows('projectOrganizations')[0]?.data.status).toBe('revoked')
    expect(db.rows('partnerResourceGrants')[0]?.data.status).toBe('revoked')
  })

  it('supports named user and team grants without widening to the partner organisation', async () => {
    db = createMemoryDb({
      partnerLinks: [{ id: 'link-recipient', data: { partnerLinkId: 'link-recipient', orgA: 'org-a', orgB: 'org-b', status: 'active' } }],
      partnerScopeAgreements: [{ id: 'scope-recipient', data: {
        partnerLinkId: 'link-recipient', status: 'active', capabilities: ['projects'],
        direction: { grantorOrgId: 'org-a', granteeOrgId: 'org-b' },
        acceptance: { grantor: { byRef: actor }, grantee: { byRef: actor } },
      } }],
      businessRelationships: [
        relationRow({ id: 'rel-a', partnerLinkId: 'link-recipient', status: 'active', sharedCapabilities: ['projects'] }),
        relationRow({ id: 'rel-b', partnerLinkId: 'link-recipient', sourceOrgId: 'org-b', targetOrgId: 'org-a', status: 'active', sharedCapabilities: ['projects'] }),
      ],
      projects: [{ id: 'proj-1', data: { ownerOrgId: 'org-a', orgId: 'org-a', name: 'Website', deleted: false } }],
      projectMembers: [{ id: 'proj-1_user:tester', data: { uid: 'user:tester', orgId: 'org-a', role: 'manager', status: 'active' } }],
    })
    mockCollection.mockImplementation(db.collection)

    await grantPartnerProjectAccess({
      ownerOrgId: 'org-a', relationshipId: 'rel-a', projectId: 'proj-1', actor,
      grantee: { includePartnerOrganization: false, userIds: ['user-b'], teamIds: ['team-b'] },
    })

    expect(db.rows('partnerResourceGrants')[0]?.data.grantee).toEqual({
      orgIds: [], userIds: ['user-b'], teamIds: ['team-b'],
    })
  })

  it('capability gate still applies on a live link', async () => {
    db = createMemoryDb({
      businessRelationships: [
        relationRow({ id: 'rel-a', partnerLinkId: 'link-w', status: 'active', sharedCapabilities: ['documents'] }),
        relationRow({ id: 'rel-b', partnerLinkId: 'link-w', sourceOrgId: 'org-b', targetOrgId: 'org-a', status: 'active', sharedCapabilities: ['documents'] }),
      ],
      projects: [{ id: 'proj-1', data: { orgId: 'org-a', name: 'Website', deleted: false } }],
    })
    mockCollection.mockImplementation(db.collection)

    await expect(grantPartnerProjectAccess({
      ownerOrgId: 'org-a',
      relationshipId: 'rel-a',
      projectId: 'proj-1',
      role: 'contributor',
      actor,
    })).rejects.toThrow(/does not share "projects"/)
  })
})
