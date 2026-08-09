/** @jest-environment node */
// Firestore rules emulator coverage for CRM tenant isolation (P0):
// direct client-SDK access to contacts / deals / activities is denied for
// every actor class — restricted admins, normal members, revoked members,
// unrelated tenants and even global admins (users.role == "admin"). The only
// org-scoped client surface (organizations/{orgId}/crm_live_updates) remains
// readable for ACTIVE members of that org only.
//
// Run: npm run test:config:crm-emulator
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import fs from 'node:fs'
import path from 'node:path'

const projectId = 'crm-rules-emulator'
jest.setTimeout(60_000)

const emulatorAvailable = !!process.env.FIRESTORE_EMULATOR_HOST
const describeCrmRules = emulatorAvailable ? describe : describe.skip

const ORG_A = 'org-a'
const ORG_B = 'org-b'

// Actor classes
const GLOBAL_ADMIN = 'uid-global-admin'       // users.role = admin (the old bypass)
const RESTRICTED_ADMIN = 'uid-restricted-admin' // org A admin, NOT global admin
const NORMAL_MEMBER = 'uid-normal-member'       // org A member, active
const REVOKED_MEMBER = 'uid-revoked-member'     // org A member row revoked
const UNRELATED_TENANT = 'uid-unrelated-tenant' // org B member

function memberDocId(orgId: string, uid: string) {
  return `${orgId}_${uid}`
}

describeCrmRules('CRM Firestore rules tenant isolation', () => {
  let environment: RulesTestEnvironment
  let adminDb: ReturnType<typeof getFirestore>

  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId,
      firestore: { rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8') },
    })
    const app = initializeApp({ projectId }, `crm-rules-${Date.now()}`)
    adminDb = getFirestore(app)
  })

  afterAll(async () => {
    await environment?.cleanup()
    await Promise.all(getApps().filter((a) => a.name.startsWith('crm-rules-')).map(deleteApp))
  })

  beforeEach(async () => {
    await environment.clearFirestore()

    // Seed users docs (role flags are what the OLD rules consulted).
    await adminDb.collection('users').doc(GLOBAL_ADMIN).set({ role: 'admin', email: 'admin@pib.example' })
    await adminDb.collection('users').doc(RESTRICTED_ADMIN).set({ role: 'member', email: 'restricted@a.example' })
    await adminDb.collection('users').doc(NORMAL_MEMBER).set({ role: 'member', email: 'member@a.example' })
    await adminDb.collection('users').doc(REVOKED_MEMBER).set({ role: 'member', email: 'revoked@a.example' })
    await adminDb.collection('users').doc(UNRELATED_TENANT).set({ role: 'member', email: 'tenant@b.example' })

    // Seed orgMembers rows (canonical membership source).
    await adminDb.collection('orgMembers').doc(memberDocId(ORG_A, RESTRICTED_ADMIN)).set({ role: 'admin', status: 'active' })
    await adminDb.collection('orgMembers').doc(memberDocId(ORG_A, NORMAL_MEMBER)).set({ role: 'member', status: 'active' })
    // Revoked member: row still exists but status = revoked (a disabled/revoked flag
    // must never grant access).
    await adminDb.collection('orgMembers').doc(memberDocId(ORG_A, REVOKED_MEMBER)).set({ role: 'member', status: 'revoked' })
    // Unrelated tenant belongs to org B only.
    await adminDb.collection('orgMembers').doc(memberDocId(ORG_B, UNRELATED_TENANT)).set({ role: 'member', status: 'active' })

    // Seed CRM rows for both orgs.
    await adminDb.collection('contacts').doc('contact-a').set({ orgId: ORG_A, name: 'Acme A', email: 'a@example.com' })
    await adminDb.collection('contacts').doc('contact-b').set({ orgId: ORG_B, name: 'Beta B', email: 'b@example.com' })
    await adminDb.collection('deals').doc('deal-a').set({ orgId: ORG_A, title: 'Deal A', value: 100 })
    await adminDb.collection('activities').doc('activity-a').set({ orgId: ORG_A, summary: 'called' })

    // Seed the org-scoped live-update surface (the only sanctioned client read).
    await adminDb.collection('organizations').doc(ORG_A).set({
      name: 'Org A',
      members: [
        { userId: RESTRICTED_ADMIN, role: 'admin' },
        { userId: NORMAL_MEMBER, role: 'member' },
      ],
    })
    await adminDb.collection('organizations').doc(ORG_B).set({
      name: 'Org B',
      members: [{ userId: UNRELATED_TENANT, role: 'member' }],
    })
    await adminDb.collection('organizations').doc(ORG_A).collection('crm_live_updates').doc('contacts').set({ bumpedAt: 1 })
  })

  const crmCollections = [
    ['contacts', 'contact-a'],
    ['deals', 'deal-a'],
    ['activities', 'activity-a'],
  ] as const

  describe('contacts / deals / activities direct client-SDK access', () => {
    it.each(crmCollections)('%s: denied for EVERY actor class incl. global admin', async (collection, docId) => {
      for (const uid of [GLOBAL_ADMIN, RESTRICTED_ADMIN, NORMAL_MEMBER, REVOKED_MEMBER, UNRELATED_TENANT]) {
        const authed = environment.authenticatedContext(uid)
        await assertFails(getDoc(doc(authed.firestore(), collection, docId)), `expected ${uid} to be denied ${collection}/${docId}`)
      }
    })

    it.each(crmCollections)('%s: denied for EVERY actor class on write', async (collection, docId) => {
      for (const uid of [GLOBAL_ADMIN, RESTRICTED_ADMIN, NORMAL_MEMBER, REVOKED_MEMBER, UNRELATED_TENANT]) {
        const authed = environment.authenticatedContext(uid)
        await assertFails(
          setDoc(doc(authed.firestore(), collection, `new-${uid}`), { orgId: ORG_A, name: 'x' }),
          `expected ${uid} to be denied write to ${collection}`,
        )
      }
    })

    it('denies unauthenticated reads too', async () => {
      const anon = environment.unauthenticatedContext()
      await assertFails(getDoc(doc(anon.firestore(), 'contacts', 'contact-a')))
    })
  })

  describe('org-scoped live updates (only sanctioned client surface)', () => {
    it('active member of the owning org CAN read their own org live update', async () => {
      const authed = environment.authenticatedContext(NORMAL_MEMBER)
      await assertSucceeds(
        getDoc(doc(authed.firestore(), 'organizations', ORG_A, 'crm_live_updates', 'contacts')),
      )
    })

    it('org admin (not global) CAN read their own org live update', async () => {
      const authed = environment.authenticatedContext(RESTRICTED_ADMIN)
      await assertSucceeds(
        getDoc(doc(authed.firestore(), 'organizations', ORG_A, 'crm_live_updates', 'contacts')),
      )
    })

    it('revoked member CANNOT read the org live update even though a row exists', async () => {
      const authed = environment.authenticatedContext(REVOKED_MEMBER)
      await assertFails(
        getDoc(doc(authed.firestore(), 'organizations', ORG_A, 'crm_live_updates', 'contacts')),
      )
    })

    it('unrelated tenant CANNOT read another org live update', async () => {
      const authed = environment.authenticatedContext(UNRELATED_TENANT)
      await assertFails(
        getDoc(doc(authed.firestore(), 'organizations', ORG_A, 'crm_live_updates', 'contacts')),
      )
    })

    it('global admin CANNOT read another org live update (no isAdmin fallback)', async () => {
      const authed = environment.authenticatedContext(GLOBAL_ADMIN)
      await assertFails(
        getDoc(doc(authed.firestore(), 'organizations', ORG_A, 'crm_live_updates', 'contacts')),
      )
    })

    it('writes to live updates stay denied for active members', async () => {
      const authed = environment.authenticatedContext(NORMAL_MEMBER)
      await assertFails(
        setDoc(doc(authed.firestore(), 'organizations', ORG_A, 'crm_live_updates', 'contacts'), { bumpedAt: 2 }),
      )
    })
  })
})
