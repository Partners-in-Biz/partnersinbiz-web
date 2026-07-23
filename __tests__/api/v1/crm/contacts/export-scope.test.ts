import { seedOrgMember, callAsMember } from '../../../../helpers/crm'
import { makePortalAuthCollections } from '../../../../helpers/firebase-admin'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'

process.env.SESSION_COOKIE_NAME = '__session'

const SCOPED_POLICY = {
  preset: 'crm_sales',
  modules: {
    crm: true,
    projects: false,
    documents: false,
    marketing: false,
    messages: false,
    email: false,
    reports: true,
    research: false,
    properties: false,
    billing: true,
    mobileApps: false,
    youtubeStudio: false,
    bookStudio: false,
  },
  recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
}

function stageExport(opts: {
  role?: 'member' | 'admin' | 'owner' | 'viewer'
  membersCanExportContacts?: boolean
  accessPolicy?: Record<string, unknown>
  contacts?: Array<{ id: string; data: Record<string, unknown> }>
  companies?: Array<{ id: string; data: Record<string, unknown> }>
}) {
  const member = {
    ...seedOrgMember('org-1', 'stean', { role: opts.role ?? 'member', firstName: 'Stean' }),
    status: 'active',
    accessPolicy: opts.accessPolicy ?? SCOPED_POLICY,
  }
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  const authCollections = makePortalAuthCollections(member, {
    permissions: {
      membersCanExportContacts: opts.membersCanExportContacts ?? true,
    },
  })

  const contactDocs = (opts.contacts ?? []).map((row) => ({
    id: row.id,
    data: () => row.data,
  }))
  const companyById = new Map((opts.companies ?? []).map((row) => [row.id, row.data]))

  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users' || name === 'orgMembers') return authCollections[name]
    if (name === 'organizations') return authCollections.organizations
    if (name === 'contacts') {
      return {
        where: () => ({
          get: () => Promise.resolve({ docs: contactDocs }),
        }),
        doc: (id: string) => ({
          get: () => {
            const found = contactDocs.find((doc) => doc.id === id)
            return Promise.resolve({
              exists: Boolean(found),
              data: () => found?.data() ?? {},
            })
          },
        }),
      }
    }
    if (name === 'companies') {
      return {
        doc: (id: string) => ({
          get: () => {
            const data = companyById.get(id)
            return Promise.resolve({
              exists: Boolean(data),
              data: () => data ?? {},
            })
          },
        }),
      }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })

  return member
}

describe('GET /api/v1/crm/contacts/export scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('blocks member export when membersCanExportContacts is off', async () => {
    const member = stageExport({ membersCanExportContacts: false })
    const { GET } = await import('@/app/api/v1/crm/contacts/export/route')
    const req = callAsMember(member, 'GET', '/api/v1/crm/contacts/export')
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('exports only owned_or_linked contacts for scoped members', async () => {
    const member = stageExport({
      membersCanExportContacts: true,
      contacts: [
        { id: 'c-mine', data: { orgId: 'org-1', name: 'Mine', email: 'mine@example.com', assignedTo: 'stean' } },
        { id: 'c-other', data: { orgId: 'org-1', name: 'Other', email: 'other@example.com', assignedTo: 'other' } },
      ],
      companies: [],
    })

    const { GET } = await import('@/app/api/v1/crm/contacts/export/route')
    const req = callAsMember(member, 'GET', '/api/v1/crm/contacts/export')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const csv = await res.text()
    expect(csv).toContain('mine@example.com')
    expect(csv).not.toContain('other@example.com')
  })
})
