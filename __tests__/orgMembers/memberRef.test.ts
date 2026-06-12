jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(),
  },
}))

import { adminDb } from '@/lib/firebase/admin'
import {
  AGENT_PIP_REF,
  LEGACY_REF,
  FORMER_MEMBER_REF,
  formSubmissionRef,
  resolveMemberRef,
  snapshotForWrite,
} from '@/lib/orgMembers/memberRef'

const ORG_ID = 'org-test'
const UID = 'uid-real'

function docSnap(exists: boolean, data: Record<string, unknown> = {}) {
  return {
    exists,
    data: () => (exists ? data : undefined),
  }
}

function mockMemberLookups({
  orgMember,
  orgMembersArray = [],
  user,
}: {
  orgMember?: Record<string, unknown> | null
  orgMembersArray?: Record<string, unknown>[]
  user?: Record<string, unknown> | null
}) {
  const docGet = jest.fn((collectionName: string, docId: string) => {
    if (collectionName === 'orgMembers') return Promise.resolve(docSnap(Boolean(orgMember), orgMember ?? {}))
    if (collectionName === 'organizations') {
      return Promise.resolve(docSnap(true, { members: orgMembersArray }))
    }
    if (collectionName === 'users') return Promise.resolve(docSnap(Boolean(user), user ?? {}))
    return Promise.resolve(docSnap(false))
  })

  ;(adminDb.collection as jest.Mock).mockImplementation((collectionName: string) => ({
    doc: (docId: string) => ({ get: () => docGet(collectionName, docId) }),
  }))
  return { docGet }
}

function mockMemberDoc(exists: boolean, data: Record<string, unknown> = {}) {
  return mockMemberLookups({ orgMember: exists ? data : null })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('AGENT_PIP_REF', () => {
  it('is the synthetic Pip actor with kind=agent', () => {
    expect(AGENT_PIP_REF).toEqual({
      uid: 'agent:pip',
      displayName: 'Pip',
      jobTitle: 'AI Agent',
      kind: 'agent',
    })
  })
})

describe('LEGACY_REF', () => {
  it('represents pre-rewire records', () => {
    expect(LEGACY_REF.uid).toBe('system:legacy')
    expect(LEGACY_REF.kind).toBe('system')
    expect(LEGACY_REF.displayName).toBe('Imported')
  })
})

describe('FORMER_MEMBER_REF', () => {
  it('builds a former-member ref from a uid', () => {
    expect(FORMER_MEMBER_REF('uid-x')).toEqual({
      uid: 'uid-x',
      displayName: 'Former member',
      kind: 'system',
    })
  })
})

describe('formSubmissionRef', () => {
  it('builds a form-submission ref scoped to formId', () => {
    expect(formSubmissionRef('form-123', 'Newsletter Signup')).toEqual({
      uid: 'system:form-submission:form-123',
      displayName: 'Newsletter Signup',
      kind: 'system',
    })
  })
})

describe('resolveMemberRef', () => {
  it('returns a real-member MemberRef when orgMembers doc exists', async () => {
    mockMemberDoc(true, {
      firstName: 'Peet',
      lastName: 'Stander',
      jobTitle: 'Founder',
      avatarUrl: 'https://x.test/a.jpg',
    })
    const ref = await resolveMemberRef(ORG_ID, UID)
    expect(ref).toEqual({
      uid: UID,
      displayName: 'Peet Stander',
      jobTitle: 'Founder',
      avatarUrl: 'https://x.test/a.jpg',
      kind: 'human',
    })
  })

  it('falls back to the organization members array when the orgMembers mirror is missing', async () => {
    mockMemberLookups({
      orgMember: null,
      orgMembersArray: [
        { userId: 'other', displayName: 'Other Person' },
        { userId: UID, displayName: 'Stean van Wyk', role: 'member' },
      ],
    })
    const ref = await resolveMemberRef(ORG_ID, UID)
    expect(ref).toEqual({ uid: UID, displayName: 'Stean van Wyk', kind: 'human' })
  })

  it('falls back to the users doc when membership snapshots are missing', async () => {
    mockMemberLookups({
      orgMember: null,
      orgMembersArray: [],
      user: { displayName: 'Anthony van Diggelen', photoURL: 'https://x.test/u.jpg' },
    })
    const ref = await resolveMemberRef(ORG_ID, UID)
    expect(ref).toEqual({
      uid: UID,
      displayName: 'Anthony van Diggelen',
      avatarUrl: 'https://x.test/u.jpg',
      kind: 'human',
    })
  })

  it('falls back to FORMER_MEMBER_REF when no member or user document exists', async () => {
    mockMemberLookups({ orgMember: null, orgMembersArray: [], user: null })
    const ref = await resolveMemberRef(ORG_ID, UID)
    expect(ref).toEqual(FORMER_MEMBER_REF(UID))
  })

  it('handles missing names with email/uid fallback in displayName', async () => {
    mockMemberDoc(true, { jobTitle: 'Member', email: 'member@example.com' })
    const ref = await resolveMemberRef(ORG_ID, UID)
    expect(ref.displayName).toBe('member@example.com')
    expect(ref.kind).toBe('human')
  })
})

describe('snapshotForWrite', () => {
  it('returns the same shape as resolveMemberRef when member exists', async () => {
    mockMemberDoc(true, { firstName: 'A', lastName: 'B' })
    const ref = await snapshotForWrite(ORG_ID, UID)
    expect(ref.displayName).toBe('A B')
    expect(ref.kind).toBe('human')
  })

  it('uses organization members array fallback for write snapshots', async () => {
    mockMemberLookups({ orgMember: null, orgMembersArray: [{ userId: UID, displayName: 'Fallback Member' }] })
    const ref = await snapshotForWrite(ORG_ID, UID)
    expect(ref.displayName).toBe('Fallback Member')
    expect(ref.kind).toBe('human')
  })

  it('throws when member and user records are missing', async () => {
    mockMemberLookups({ orgMember: null, orgMembersArray: [], user: null })
    await expect(snapshotForWrite(ORG_ID, UID)).rejects.toThrow(/not a member/i)
  })
})
