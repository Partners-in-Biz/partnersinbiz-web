/**
 * Emulator-backed verification for cross-org partner links.
 *
 * EMULATOR-ONLY — refuses to run unless FIRESTORE_EMULATOR_HOST is set, so it
 * can never touch production data.
 *
 * Run:
 *   firebase emulators:exec --only firestore --project partner-links-verify \
 *     "npx tsx scripts/verify-partner-links.ts"
 *
 * Exercises the store layer directly (createPartnerInvite → acceptPartnerInvite
 * → unlinkPartnership) and asserts the resulting Firestore state on BOTH sides.
 */

import { initializeApp, getApps } from 'firebase-admin/app'

const emulator = process.env.FIRESTORE_EMULATOR_HOST
if (!emulator) {
  console.error('REFUSED: FIRESTORE_EMULATOR_HOST is not set. This script is emulator-only.')
  process.exit(1)
}

// Initialise the default app before anything imports lib/firebase/admin, so its
// getAdminApp() short-circuits on getApps() and never calls cert() with real
// service-account env vars.
if (getApps().length === 0) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'partner-links-verify' })
}

let failures = 0
let checks = 0

function check(label: string, condition: boolean, detail?: unknown): void {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.error(`  FAIL ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
  }
}

async function main() {
  const { adminDb } = await import('@/lib/firebase/admin')
  const { createPartnerInvite, acceptPartnerInvite, unlinkPartnership, getPartnerInviteById, listPartnerLinks } =
    await import('@/lib/partner-links/store')
  const { Timestamp } = await import('firebase-admin/firestore')

  const actor = { uid: 'user:tester', displayName: 'Tester', kind: 'human' as const }
  const now = Timestamp.now()

  async function seedOrg(id: string, name: string, website?: string) {
    await adminDb.collection('organizations').doc(id).set({
      name, slug: id, type: 'client', status: 'active', website: website ?? '',
      members: [], createdAt: now, updatedAt: now,
    })
  }

  async function seedCompany(orgId: string, name: string, extra: Record<string, unknown> = {}) {
    const ref = adminDb.collection('companies').doc()
    await ref.set({ orgId, name, tags: [], notes: '', deleted: false, createdAt: now, updatedAt: now, ...extra })
    return ref.id
  }

  async function seedContact(orgId: string, name: string, email: string, extra: Record<string, unknown> = {}) {
    const ref = adminDb.collection('contacts').doc()
    await ref.set({
      orgId, name, email: email.toLowerCase(), tags: [], notes: '', deleted: false,
      createdAt: now, updatedAt: now, ...extra,
    })
    return ref.id
  }

  const doc = async (col: string, id: string) => (await adminDb.collection(col).doc(id).get()).data() ?? {}

  // =======================================================================
  console.log('\n[1] Cold invite — recipient has no CRM contact yet')
  // =======================================================================
  await seedOrg('org-a', 'Alpha Consulting', 'https://alpha.example')
  await seedOrg('org-b', 'Beta Manufacturing', 'https://beta.example')
  const aCompanyBeta = await seedCompany('org-a', 'Beta Manufacturing')

  const { invite: inv1, created: created1 } = await createPartnerInvite({
    kind: 'company',
    sourceOrgId: 'org-a',
    sourceCompanyId: aCompanyBeta,
    recipientEmail: 'Owner@Beta.Example',
    recipientName: 'Bea Owner',
    recipientCompanyName: 'Beta Manufacturing',
    actor,
    inviterUserId: 'user:alpha-boss',
    inviterEmail: 'boss@alpha.example',
    inviterName: 'Alpha Boss',
  })
  check('invite created', created1)
  check('email normalised to lowercase', inv1.recipientEmail === 'owner@beta.example', inv1.recipientEmail)
  check('token is 48 hex chars', /^[a-f0-9]{48}$/.test(inv1.inviteToken), inv1.inviteToken?.length)
  check('starts pending (no auto-link)', inv1.status === 'pending', inv1.status)

  const { invite: inv1b, created: created1b } = await createPartnerInvite({
    kind: 'company', sourceOrgId: 'org-a', sourceCompanyId: aCompanyBeta,
    recipientEmail: 'owner@beta.example', actor,
  })
  check('re-invite is idempotent (same token)', !created1b && inv1b.inviteToken === inv1.inviteToken)

  const r1 = await acceptPartnerInvite({
    invite: inv1, targetOrgId: 'org-b', targetUserId: 'user:bea', actor,
  })

  const aCompanyAfter = await doc('companies', aCompanyBeta)
  check('A: company.linkedOrgId = org-b', aCompanyAfter.linkedOrgId === 'org-b', aCompanyAfter.linkedOrgId)

  check('A: contact created for recipient', Boolean(r1.sourceContactId))
  const aContact = await doc('contacts', r1.sourceContactId!)
  check('A: contact.linkedUserId = user:bea', aContact.linkedUserId === 'user:bea', aContact.linkedUserId)
  check('A: contact.linkedOrgId = org-b', aContact.linkedOrgId === 'org-b', aContact.linkedOrgId)
  check('A: contact attached to invited company', aContact.companyId === aCompanyBeta, aContact.companyId)

  const bMirror = await doc('companies', r1.targetCompanyId)
  check('B: mirror company created', bMirror.orgId === 'org-b', bMirror.orgId)
  check('B: mirror company.linkedOrgId = org-a', bMirror.linkedOrgId === 'org-a', bMirror.linkedOrgId)
  check('B: mirror company named after org A', bMirror.name === 'Alpha Consulting', bMirror.name)

  check('B: mirror contact for the inviter', Boolean(r1.targetContactId))
  const bContact = await doc('contacts', r1.targetContactId!)
  check('B: mirror contact.linkedUserId = inviter', bContact.linkedUserId === 'user:alpha-boss', bContact.linkedUserId)
  check('B: mirror contact.linkedOrgId = org-a', bContact.linkedOrgId === 'org-a', bContact.linkedOrgId)

  const rel1 = await doc('businessRelationships', r1.sourceRelationshipId)
  const rel2 = await doc('businessRelationships', r1.targetRelationshipId)
  check('A→B relationship sourceOrgId', rel1.sourceOrgId === 'org-a', rel1.sourceOrgId)
  check('B→A relationship sourceOrgId', rel2.sourceOrgId === 'org-b', rel2.sourceOrgId)
  check('both relationships share partnerLinkId',
    rel1.partnerLinkId === rel2.partnerLinkId && Boolean(rel1.partnerLinkId))
  check('both typed as partner',
    rel1.relationshipType === 'partner' && rel2.relationshipType === 'partner')
  check('both active', rel1.status === 'active' && rel2.status === 'active')

  const inv1Final = await getPartnerInviteById(inv1.id)
  check('invite marked accepted', inv1Final?.status === 'accepted', inv1Final?.status)

  // =======================================================================
  console.log('\n[2] Existing contact with matching email is linked, not duplicated')
  // =======================================================================
  await seedOrg('org-c', 'Gamma Supplies', 'https://gamma.example')
  const aCompanyGamma = await seedCompany('org-a', 'Gamma Supplies')
  const existingContact = await seedContact('org-a', 'Gary Gamma', 'gary@gamma.example', {
    companyId: aCompanyGamma, companyName: 'Gamma Supplies',
  })

  const { invite: inv2 } = await createPartnerInvite({
    kind: 'company', sourceOrgId: 'org-a', sourceCompanyId: aCompanyGamma,
    recipientEmail: 'gary@gamma.example', recipientName: 'Gary Gamma', actor,
    inviterUserId: 'user:alpha-boss', inviterEmail: 'boss@alpha.example', inviterName: 'Alpha Boss',
  })
  const r2 = await acceptPartnerInvite({
    invite: inv2, targetOrgId: 'org-c', targetUserId: 'user:gary', actor,
  })

  check('reused the existing contact (no duplicate)', r2.sourceContactId === existingContact,
    { got: r2.sourceContactId, expected: existingContact })
  const gammaContacts = await adminDb.collection('contacts')
    .where('orgId', '==', 'org-a').where('email', '==', 'gary@gamma.example').get()
  check('exactly one contact with that email in A', gammaContacts.size === 1, gammaContacts.size)
  const garyAfter = await doc('contacts', existingContact)
  check('existing contact got linkedUserId', garyAfter.linkedUserId === 'user:gary', garyAfter.linkedUserId)

  // =======================================================================
  console.log('\n[3] Acceptor picks an existing company (preferTargetCompanyId)')
  // =======================================================================
  await seedOrg('org-d', 'Delta Retail', 'https://delta.example')
  const aCompanyDelta = await seedCompany('org-a', 'Delta Retail')
  const dExistingAlpha = await seedCompany('org-d', 'Alpha Consulting (our supplier)')

  const { invite: inv3 } = await createPartnerInvite({
    kind: 'company', sourceOrgId: 'org-a', sourceCompanyId: aCompanyDelta,
    recipientEmail: 'dee@delta.example', actor,
    inviterUserId: 'user:alpha-boss', inviterEmail: 'boss@alpha.example', inviterName: 'Alpha Boss',
  })
  const r3 = await acceptPartnerInvite({
    invite: inv3, targetOrgId: 'org-d', targetUserId: 'user:dee',
    preferTargetCompanyId: dExistingAlpha, actor,
  })
  check('linked the chosen company', r3.targetCompanyId === dExistingAlpha,
    { got: r3.targetCompanyId, expected: dExistingAlpha })
  const dCompanies = await adminDb.collection('companies').where('orgId', '==', 'org-d').get()
  check('no duplicate company created in D', dCompanies.size === 1, dCompanies.size)
  const dChosen = await doc('companies', dExistingAlpha)
  check('chosen company keeps its own name', dChosen.name === 'Alpha Consulting (our supplier)', dChosen.name)
  check('chosen company got linkedOrgId', dChosen.linkedOrgId === 'org-a', dChosen.linkedOrgId)

  // =======================================================================
  console.log('\n[4] Contact-kind invite stamps the named contact')
  // =======================================================================
  await seedOrg('org-e', 'Epsilon Labs', 'https://epsilon.example')
  const aCompanyEpsilon = await seedCompany('org-a', 'Epsilon Labs')
  const namedContact = await seedContact('org-a', 'Eve Epsilon', 'eve@epsilon.example', {
    companyId: aCompanyEpsilon, companyName: 'Epsilon Labs',
  })
  // A decoy sharing the company but not the invite.
  await seedContact('org-a', 'Other Person', 'other@epsilon.example', { companyId: aCompanyEpsilon })

  const { invite: inv4 } = await createPartnerInvite({
    kind: 'contact', sourceOrgId: 'org-a', sourceCompanyId: aCompanyEpsilon,
    sourceContactId: namedContact, recipientEmail: 'eve@epsilon.example', actor,
    inviterUserId: 'user:alpha-boss', inviterEmail: 'boss@alpha.example', inviterName: 'Alpha Boss',
  })
  const r4 = await acceptPartnerInvite({
    invite: inv4, targetOrgId: 'org-e', targetUserId: 'user:eve', actor,
  })
  check('named contact is the one linked', r4.sourceContactId === namedContact,
    { got: r4.sourceContactId, expected: namedContact })
  const eveAfter = await doc('contacts', namedContact)
  check('named contact.linkedUserId set', eveAfter.linkedUserId === 'user:eve', eveAfter.linkedUserId)
  const decoy = await adminDb.collection('contacts')
    .where('orgId', '==', 'org-a').where('email', '==', 'other@epsilon.example').get()
  check('decoy contact untouched', !decoy.docs[0].data().linkedUserId)
  check('parent company still links', (await doc('companies', aCompanyEpsilon)).linkedOrgId === 'org-e')

  // =======================================================================
  console.log('\n[4b] A rejected company pick leaves the inviter untouched')
  // =======================================================================
  await seedOrg('org-f', 'Foxtrot Ltd')
  await seedOrg('org-x', 'Someone Else')
  const aCompanyFoxtrot = await seedCompany('org-a', 'Foxtrot Ltd')
  // A company in F already spoken for by an unrelated org.
  const fTakenCompany = await seedCompany('org-f', 'Taken Co', { linkedOrgId: 'org-x' })

  const { invite: inv4b } = await createPartnerInvite({
    kind: 'company', sourceOrgId: 'org-a', sourceCompanyId: aCompanyFoxtrot,
    recipientEmail: 'fox@foxtrot.example', actor,
    inviterUserId: 'user:alpha-boss', inviterEmail: 'boss@alpha.example', inviterName: 'Alpha Boss',
  })
  let rejected = false
  try {
    await acceptPartnerInvite({
      invite: inv4b, targetOrgId: 'org-f', targetUserId: 'user:fox',
      preferTargetCompanyId: fTakenCompany, actor,
    })
  } catch {
    rejected = true
  }
  check('picking an already-linked company throws', rejected)
  check('inviter company NOT half-linked', (await doc('companies', aCompanyFoxtrot)).linkedOrgId === undefined,
    (await doc('companies', aCompanyFoxtrot)).linkedOrgId)
  check('invite still pending after rejection',
    (await getPartnerInviteById(inv4b.id))?.status === 'pending')
  check('other org\'s company untouched', (await doc('companies', fTakenCompany)).linkedOrgId === 'org-x')

  // =======================================================================
  console.log('\n[4c] listPartnerLinks powers the portal Partners page')
  // =======================================================================
  const aLinks = await listPartnerLinks('org-a')
  check('A sees its partner links', aLinks.length >= 3, aLinks.length)
  check('every row carries a partnerLinkId', aLinks.every((l) => Boolean(l.partnerLinkId)))
  check('rows are scoped to org A only',
    aLinks.every((l) => l.partnerOrgId !== 'org-a'))
  const betaRow = aLinks.find((l) => l.partnerOrgId === 'org-b')
  check('Beta link resolves its CRM company name', betaRow?.companyName === 'Beta Manufacturing', betaRow?.companyName)
  check('Beta link is active before unlink', betaRow?.status === 'active', betaRow?.status)

  const bLinks = await listPartnerLinks('org-b')
  check('B sees the reciprocal link', bLinks.some((l) => l.partnerOrgId === 'org-a'), bLinks.length)

  // =======================================================================
  console.log('\n[4d] Per-record sharing across an accepted link (Phase 2)')
  // =======================================================================
  const {
    sharePartnerRecord, loadSharedRecord, listIncomingShares, listOutgoingShares,
    revokePartnerShare,
  } = await import('@/lib/partner-links/shares')

  // A project owned by org A, plus a decoy owned by org C.
  const projRef = adminDb.collection('projects').doc()
  await projRef.set({
    orgId: 'org-a', name: 'Shared Delivery Project', status: 'active',
    description: 'Visible to the partner', secretField: 'MUST NOT LEAK',
    deleted: false, createdAt: now, updatedAt: now,
  })
  const foreignRef = adminDb.collection('projects').doc()
  await foreignRef.set({ orgId: 'org-c', name: 'Not Yours', deleted: false, createdAt: now, updatedAt: now })

  const share1 = await sharePartnerRecord({
    ownerOrgId: 'org-a', relationshipId: r1.sourceRelationshipId,
    resourceType: 'project', resourceId: projRef.id, actor,
  })
  check('share created active', share1.status === 'active', share1.status)
  check('share targets the partner org', share1.partnerOrgId === 'org-b', share1.partnerOrgId)
  check('share denormalises the title', share1.resourceTitle === 'Shared Delivery Project', share1.resourceTitle)

  const share1again = await sharePartnerRecord({
    ownerOrgId: 'org-a', relationshipId: r1.sourceRelationshipId,
    resourceType: 'project', resourceId: projRef.id, actor,
  })
  check('re-sharing is idempotent', share1again.id === share1.id)

  const view = await loadSharedRecord({ shareId: share1.id, viewerOrgId: 'org-b' })
  check('partner can read the shared record', view.record.name === 'Shared Delivery Project', view.record.name)
  check('owner org name resolved', view.ownerOrgName === 'Alpha Consulting', view.ownerOrgName)
  check('NON-whitelisted field is withheld', view.record.secretField === undefined, view.record.secretField)
  check('whitelisted description passes through', view.record.description === 'Visible to the partner')

  let denied = false
  try { await loadSharedRecord({ shareId: share1.id, viewerOrgId: 'org-c' }) } catch { denied = true }
  check('an unrelated org cannot read the share', denied)

  let foreignRejected = false
  try {
    await sharePartnerRecord({
      ownerOrgId: 'org-a', relationshipId: r1.sourceRelationshipId,
      resourceType: 'project', resourceId: foreignRef.id, actor,
    })
  } catch { foreignRejected = true }
  check('cannot share a record you do not own', foreignRejected)

  // Capability gate: invoices are not in the default capability set.
  let capBlocked = false
  const invRef = adminDb.collection('invoices').doc()
  await invRef.set({ orgId: 'org-a', invoiceNumber: 'INV-1', deleted: false, createdAt: now, updatedAt: now })
  try {
    await sharePartnerRecord({
      ownerOrgId: 'org-a', relationshipId: r1.sourceRelationshipId,
      resourceType: 'invoice', resourceId: invRef.id, actor,
    })
  } catch { capBlocked = true }
  check('capability gate blocks un-shared record types', capBlocked)

  check('outgoing list shows the share',
    (await listOutgoingShares('org-a')).some((s) => s.id === share1.id))
  check('incoming list shows it for the partner',
    (await listIncomingShares('org-b')).some((s) => s.id === share1.id))
  check('incoming list is empty for an unrelated org',
    (await listIncomingShares('org-c')).length === 0)

  // Revoke, then re-share so section [5] can prove unlink tears shares down.
  await revokePartnerShare({ shareId: share1.id, actingOrgId: 'org-a', actor })
  let revokedRead = false
  try { await loadSharedRecord({ shareId: share1.id, viewerOrgId: 'org-b' }) } catch { revokedRead = true }
  check('revoked share is unreadable', revokedRead)

  const share2 = await sharePartnerRecord({
    ownerOrgId: 'org-a', relationshipId: r1.sourceRelationshipId,
    resourceType: 'project', resourceId: projRef.id, actor,
  })
  check('record can be re-shared after revoke', share2.status === 'active' && share2.id !== share1.id)

  // =======================================================================
  console.log('\n[5] Unlink from the accepting side')
  // =======================================================================
  const unlinked = await unlinkPartnership({
    relationshipId: r1.targetRelationshipId, actingOrgId: 'org-b', actor,
  })
  check('both relationship rows revoked', unlinked.revokedRelationshipIds.length === 2,
    unlinked.revokedRelationshipIds)
  check('A→B row now revoked', (await doc('businessRelationships', r1.sourceRelationshipId)).status === 'revoked')
  check('B→A row now revoked', (await doc('businessRelationships', r1.targetRelationshipId)).status === 'revoked')
  check('A: company.linkedOrgId cleared', (await doc('companies', aCompanyBeta)).linkedOrgId === undefined)
  check('B: mirror company.linkedOrgId cleared', (await doc('companies', r1.targetCompanyId)).linkedOrgId === undefined)
  check('A: contact.linkedUserId cleared', (await doc('contacts', r1.sourceContactId!)).linkedUserId === undefined)

  const survivingCompany = await doc('companies', aCompanyBeta)
  const survivingContact = await doc('contacts', r1.sourceContactId!)
  check('A: company record survives unlink', survivingCompany.name === 'Beta Manufacturing', survivingCompany.name)
  check('A: contact record survives unlink', Boolean(survivingContact.email), survivingContact.email)
  check('B: mirror company survives unlink', Boolean((await doc('companies', r1.targetCompanyId)).name))

  check('unlink tore down the record shares', unlinked.revokedShareIds.includes(share2.id),
    unlinked.revokedShareIds)
  let postUnlinkRead = false
  try { await loadSharedRecord({ shareId: share2.id, viewerOrgId: 'org-b' }) } catch { postUnlinkRead = true }
  check('shared record unreadable after unlink', postUnlinkRead)
  check('the underlying project still exists', Boolean((await doc('projects', projRef.id)).name))

  check('unrelated link (org-c) untouched',
    (await doc('businessRelationships', r2.sourceRelationshipId)).status === 'active')
  check('unrelated company (Gamma) still linked',
    (await doc('companies', aCompanyGamma)).linkedOrgId === 'org-c')

  // =======================================================================
  console.log('\n[6] Self-link is refused')
  // =======================================================================
  const { invite: inv6 } = await createPartnerInvite({
    kind: 'company', sourceOrgId: 'org-a',
    sourceCompanyId: await seedCompany('org-a', 'Self Test'),
    recipientEmail: 'self@alpha.example', actor,
  })
  let refused = false
  try {
    await acceptPartnerInvite({ invite: inv6, targetOrgId: 'org-a', targetUserId: 'user:self', actor })
  } catch {
    refused = true
  }
  check('accepting into the inviting org throws', refused)

  // =======================================================================
  console.log('\n[7] Cross-tenant link fields are rejected from request bodies')
  // =======================================================================
  const { sanitizeCompanyForWrite } = await import('@/lib/companies/store')
  const { sanitizeContactForWrite } = await import('@/lib/crm/contacts')

  const companyBody = sanitizeCompanyForWrite({
    name: 'Attacker Co',
    linkedOrgId: 'org-victim',
  } as never)
  check('companies: linkedOrgId stripped from body', companyBody.linkedOrgId === undefined, companyBody.linkedOrgId)
  check('companies: legitimate fields still pass', companyBody.name === 'Attacker Co', companyBody.name)

  const contactBody = sanitizeContactForWrite({
    name: 'Attacker Person',
    linkedOrgId: 'org-victim',
    linkedUserId: 'user:victim',
  })
  check('contacts: linkedOrgId stripped from body', contactBody.linkedOrgId === undefined, contactBody.linkedOrgId)
  check('contacts: linkedUserId stripped from body', contactBody.linkedUserId === undefined, contactBody.linkedUserId)
  check('contacts: legitimate fields still pass', contactBody.name === 'Attacker Person', contactBody.name)

  // =======================================================================
  console.log('\n[8] Helpers extracted from the invoice/project claim route')
  // =======================================================================
  const { slugify, uniqueOrgIdForName, splitName, normalizeEmail } =
    await import('@/lib/partner-links/identity')

  check('slugify keeps the claim flow fallback', slugify('!!!', 'claimed-business') === 'claimed-business')
  check('slugify normalises', slugify('Acme  Pty Ltd!') === 'acme-pty-ltd', slugify('Acme  Pty Ltd!'))
  check('normalizeEmail trims + lowercases', normalizeEmail('  Foo@Bar.COM ') === 'foo@bar.com')
  check('splitName splits first/last',
    splitName('Bea Van Der Merwe').firstName === 'Bea' &&
    splitName('Bea Van Der Merwe').lastName === 'Van Der Merwe')

  const fresh = await uniqueOrgIdForName('Zeta Trading', 'claimed')
  check('uniqueOrgIdForName keeps the claimed- prefix', fresh.orgId === 'claimed-zeta-trading', fresh.orgId)

  await seedOrg(fresh.orgId, 'Zeta Trading')
  await adminDb.collection('organizations').doc(fresh.orgId).set({ slug: 'zeta-trading' }, { merge: true })
  const collided = await uniqueOrgIdForName('Zeta Trading', 'claimed')
  check('slug collision falls through to -2', collided.slug === 'zeta-trading-2', collided.slug)

  // =======================================================================
  console.log('\n[9] attachUserToOrg writes all three membership sources of truth')
  // =======================================================================
  const { attachUserToOrg } = await import('@/lib/partner-links/identity')
  await seedOrg('org-join', 'Join Test')
  await attachUserToOrg({
    uid: 'user:joiner', orgId: 'org-join', role: 'owner',
    email: 'joiner@join.example', displayName: 'Jo Joiner',
  })

  const memberRow = await doc('orgMembers', 'org-join_user:joiner')
  check('orgMembers row written with role', memberRow.role === 'owner', memberRow.role)
  check('orgMembers row is active', memberRow.status === 'active', memberRow.status)
  check('orgMembers name split', memberRow.firstName === 'Jo' && memberRow.lastName === 'Joiner')

  const joinOrg = await doc('organizations', 'org-join')
  check('organizations.members[] contains the user',
    Array.isArray(joinOrg.members) && joinOrg.members.some((m: { userId?: string }) => m.userId === 'user:joiner'))

  const joinUser = await doc('users', 'user:joiner')
  check('users.orgIds contains the org',
    Array.isArray(joinUser.orgIds) && joinUser.orgIds.includes('org-join'), joinUser.orgIds)
  check('users.orgId set as home org', joinUser.orgId === 'org-join', joinUser.orgId)

  // Guards the privilege-downgrade trap: this writer merges the role
  // unconditionally, which is why the accept route only calls it for a
  // workspace it just created, never for one the accepter already belongs to.
  await attachUserToOrg({
    uid: 'user:joiner', orgId: 'org-join', role: 'member',
    email: 'joiner@join.example', displayName: 'Jo Joiner',
  })
  const afterDowngrade = await doc('orgMembers', 'org-join_user:joiner')
  check('role IS overwritten on re-attach (why the route guards it)',
    afterDowngrade.role === 'member', afterDowngrade.role)

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nUNCAUGHT', err)
  process.exit(1)
})
