import { FieldValue } from 'firebase-admin/firestore'
import { touchCrmLiveUpdate } from '@/lib/crm/live-updates'

const set = jest.fn()
const doc = jest.fn(() => ({ set }))
const collection = jest.fn(() => ({ doc }))
const orgDoc = jest.fn(() => ({ collection }))
const orgCollection = { doc: orgDoc }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name === 'organizations') return orgCollection
      throw new Error(`Unexpected collection ${name}`)
    }),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

describe('CRM live updates', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('touches the org-scoped Firestore live-update document for an entity', async () => {
    await touchCrmLiveUpdate('org-1', 'companies', 'company.created')

    expect(orgDoc).toHaveBeenCalledWith('org-1')
    expect(collection).toHaveBeenCalledWith('crm_live_updates')
    expect(doc).toHaveBeenCalledWith('companies')
    expect(set).toHaveBeenCalledWith({
      entity: 'companies',
      orgId: 'org-1',
      reason: 'company.created',
      updatedAt: 'SERVER_TIMESTAMP',
    }, { merge: true })
    expect(FieldValue.serverTimestamp).toHaveBeenCalled()
  })
})
