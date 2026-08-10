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
import type { DealLineItem } from '@/lib/crm/types'

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
  const { updateBusinessRelationship } = await import('@/lib/business-relationships/store')
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
    capabilities: ['crm', 'projects', 'documents', 'services', 'invoices'],
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
  // Acceptance itself must materialize the canonical bilateral authority —
  // commerce must never depend on verifier-only seed records.
  const canonicalLink = await doc('partnerLinks', r1.partnerLinkId!)
  check('acceptance materializes canonical partner link', canonicalLink.status === 'active', canonicalLink)
  const canonicalScopes = await adminDb.collection('partnerScopeAgreements')
    .where('partnerLinkId', '==', r1.partnerLinkId).get()
  const invoiceScopeId = canonicalScopes.docs.find((scope) => {
    const direction = scope.data().direction
    return direction?.grantorOrgId === 'org-a' && direction?.granteeOrgId === 'org-b'
  })?.id ?? ''
  const scopeDirections = canonicalScopes.docs.map((scope) => scope.data().direction)
  check('acceptance materializes bilateral invoice scopes', Boolean(invoiceScopeId) && scopeDirections.some((direction) =>
    direction?.grantorOrgId === 'org-a' && direction?.granteeOrgId === 'org-b',
  ) && scopeDirections.some((direction) =>
    direction?.grantorOrgId === 'org-b' && direction?.granteeOrgId === 'org-a',
  ), scopeDirections)

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

  // Capability gate: the separate A↔C partner link does not negotiate invoices.
  let capBlocked = false
  const invRef = adminDb.collection('invoices').doc()
  await invRef.set({ orgId: 'org-a', invoiceNumber: 'INV-1', deleted: false, createdAt: now, updatedAt: now })
  try {
    await sharePartnerRecord({
      ownerOrgId: 'org-a', relationshipId: r2.sourceRelationshipId,
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
  console.log('\n[4e] Record picker search + already-shared flagging')
  // =======================================================================
  const { listShareableRecords } = await import('@/lib/partner-links/shares')

  const otherProj = adminDb.collection('projects').doc()
  await otherProj.set({
    orgId: 'org-a', name: 'Website Redesign', status: 'active',
    deleted: false, createdAt: now, updatedAt: now,
  })
  const deletedProj = adminDb.collection('projects').doc()
  await deletedProj.set({ orgId: 'org-a', name: 'Archived Thing', deleted: true, createdAt: now, updatedAt: now })

  const { records: all } = await listShareableRecords({
    orgId: 'org-a', resourceType: 'project', partnerOrgId: 'org-b', limit: 100,
  })
  check('picker returns own-org records', all.some((r) => r.id === otherProj.id))
  check('picker excludes deleted records', !all.some((r) => r.id === deletedProj.id))
  check('picker excludes other orgs\' records', !all.some((r) => r.id === foreignRef.id))
  check('picker flags already-shared', all.find((r) => r.id === projRef.id)?.alreadyShared === true)
  check('picker does not flag unshared', all.find((r) => r.id === otherProj.id)?.alreadyShared !== true)

  // Substring pass — "redesign" is mid-string in "Website Redesign".
  const { records: substr } = await listShareableRecords({
    orgId: 'org-a', resourceType: 'project', query: 'redesign',
  })
  check('substring search still matches mid-title',
    substr.length === 1 && substr[0].id === otherProj.id, substr.map((r) => r.title))

  // Prefix pass — this is the one that scales past the scan window.
  const { records: prefix } = await listShareableRecords({
    orgId: 'org-a', resourceType: 'project', query: 'Website',
  })
  check('prefix search matches from the start', prefix.some((r) => r.id === otherProj.id), prefix.map((r) => r.title))

  const { records: noHits, truncated } = await listShareableRecords({
    orgId: 'org-a', resourceType: 'project', query: 'zzzznope',
  })
  check('picker returns nothing for a non-match', noHits.length === 0, noHits.length)
  check('truncated is false on a small corpus', truncated === false, truncated)

  // =======================================================================
  console.log('\n[4f] permission:"comment" is actually enforced')
  // =======================================================================
  const {
    listShareComments, addShareComment, setSharePermission, deleteShareComment,
  } = await import('@/lib/partner-links/shares')

  const partnerActor = { uid: 'user:bea', displayName: 'Bea Owner', kind: 'human' as const }

  // share2 was created with the default permission (view).
  check('default share permission is view', share2.permission === 'view', share2.permission)

  const asPartner = await listShareComments({ shareId: share2.id, viewerOrgId: 'org-b' })
  check('partner sees viewerRole=partner', asPartner.role === 'partner', asPartner.role)
  check('partner cannot comment on a view-only share', asPartner.canComment === false)

  let viewOnlyBlocked = false
  try {
    await addShareComment({ shareId: share2.id, viewerOrgId: 'org-b', body: 'nope', actor: partnerActor })
  } catch { viewOnlyBlocked = true }
  check('posting as partner on view-only share throws', viewOnlyBlocked)

  // The owner may always comment, even on a view-only share.
  const ownerComment = await addShareComment({
    shareId: share2.id, viewerOrgId: 'org-a', body: 'Here is the scope.', actor,
  })
  check('owner can comment regardless of permission', Boolean(ownerComment.id))
  check('comment records the author org', ownerComment.authorOrgId === 'org-a', ownerComment.authorOrgId)

  // Upgrade to comment, then the partner can post.
  const upgraded = await setSharePermission({
    shareId: share2.id, ownerOrgId: 'org-a', permission: 'comment', actor,
  })
  check('permission upgraded to comment', upgraded.permission === 'comment', upgraded.permission)

  const afterUpgrade = await listShareComments({ shareId: share2.id, viewerOrgId: 'org-b' })
  check('partner canComment after upgrade', afterUpgrade.canComment === true)

  const partnerComment = await addShareComment({
    shareId: share2.id, viewerOrgId: 'org-b', body: 'Thanks — one question on timing.', actor: partnerActor,
  })
  check('partner can now post', Boolean(partnerComment.id))

  const thread = await listShareComments({ shareId: share2.id, viewerOrgId: 'org-a' })
  check('both sides appear in the thread', thread.comments.length === 2, thread.comments.length)
  check('thread is chronological',
    thread.comments[0].body === 'Here is the scope.' && thread.comments[1].body.startsWith('Thanks'))
  check('owner sees viewerRole=owner', thread.role === 'owner', thread.role)

  let outsiderBlocked = false
  try { await listShareComments({ shareId: share2.id, viewerOrgId: 'org-c' }) } catch { outsiderBlocked = true }
  check('an unrelated org cannot read the thread', outsiderBlocked)

  let foreignDelete = false
  try { await deleteShareComment({ commentId: partnerComment.id, viewerOrgId: 'org-a' }) } catch { foreignDelete = true }
  check('you cannot delete the other side\'s comment', foreignDelete)

  await deleteShareComment({ commentId: partnerComment.id, viewerOrgId: 'org-b' })
  check('author org can delete its own comment',
    (await listShareComments({ shareId: share2.id, viewerOrgId: 'org-a' })).comments.length === 1)

  let emptyRejected = false
  try { await addShareComment({ shareId: share2.id, viewerOrgId: 'org-a', body: '   ', actor }) } catch { emptyRejected = true }
  check('empty comment rejected', emptyRejected)

  // Owner-side read of the record itself (needed so they can see the thread).
  const ownerView = await loadSharedRecord({ shareId: share2.id, viewerOrgId: 'org-a' })
  check('owner can load the shared record view', ownerView.viewerRole === 'owner', ownerView.viewerRole)
  check('owner view reports canComment', ownerView.canComment === true)

  // =======================================================================
  console.log('\n[4g] Cross-org trading: catalogue → order → confirm → invoice')
  // =======================================================================
  const {
    publishCatalogItem, unpublishCatalogItem, listPublishedCatalog,
    browsePartnerCatalog, placePartnerOrder, decidePartnerOrder, listPartnerOrders,
  } = await import('@/lib/partner-links/trade')

  // Org A is the supplier here; org B accepted the link in section [1].
  const widgetRef = adminDb.collection('products').doc()
  await widgetRef.set({
    orgId: 'org-a', name: 'Blue Widget', sku: 'BW-1', unitPrice: 100,
    currency: 'ZAR', taxRate: 15, unit: 'item', active: true, deleted: false,
    createdAt: now, updatedAt: now,
  })
  const gadgetRef = adminDb.collection('products').doc()
  await gadgetRef.set({
    orgId: 'org-a', name: 'Red Gadget', sku: 'RG-1', unitPrice: 50,
    currency: 'ZAR', active: true, deleted: false, createdAt: now, updatedAt: now,
  })
  const foreignProduct = adminDb.collection('products').doc()
  await foreignProduct.set({
    orgId: 'org-c', name: 'Not Mine', unitPrice: 9, currency: 'ZAR',
    deleted: false, createdAt: now, updatedAt: now,
  })

  // Stock: 8 available on the widget with a threshold of 10 -> low_stock.
  const widgetStock = adminDb.collection('inventoryItems').doc()
  await widgetStock.set({
    orgId: 'org-a', productId: widgetRef.id, name: 'Blue Widget',
    quantityAvailable: 8, quantityReserved: 0, lowStockThreshold: 10,
    status: 'active', deleted: false, createdAt: now, updatedAt: now,
  })

  // 'orders' is not in the default capability set, so publishing must be gated.
  let tradeGated = false
  try {
    await publishCatalogItem({
      supplierOrgId: 'org-a', relationshipId: r1.sourceRelationshipId,
      productId: widgetRef.id, actor,
    })
  } catch { tradeGated = true }
  check('publishing is gated on the "orders" capability', tradeGated)

  // Enable orders + inventory on BOTH sides of the link.
  for (const [org, relId] of [['org-a', r1.sourceRelationshipId], ['org-b', r1.targetRelationshipId]] as const) {
    await updateBusinessRelationship(org, relId, {
      sharedCapabilities: ['crm', 'projects', 'documents', 'services', 'orders', 'inventory', 'invoices'],
    }, actor)
  }

  const pub1 = await publishCatalogItem({
    supplierOrgId: 'org-a', relationshipId: r1.sourceRelationshipId,
    productId: widgetRef.id, unitPrice: 90, actor,
  })
  check('published at the negotiated price, not list price', pub1.unitPrice === 90, pub1.unitPrice)
  check('catalogue row snapshots the product name', pub1.name === 'Blue Widget', pub1.name)
  check('catalogue row is stamped with the buyer org', pub1.buyerOrgId === 'org-b', pub1.buyerOrgId)

  const pub1again = await publishCatalogItem({
    supplierOrgId: 'org-a', relationshipId: r1.sourceRelationshipId,
    productId: widgetRef.id, unitPrice: 85, actor,
  })
  check('re-publishing re-prices in place', pub1again.id === pub1.id && pub1again.unitPrice === 85)

  await publishCatalogItem({
    supplierOrgId: 'org-a', relationshipId: r1.sourceRelationshipId,
    productId: gadgetRef.id, actor,
  })

  let foreignPublish = false
  try {
    await publishCatalogItem({
      supplierOrgId: 'org-a', relationshipId: r1.sourceRelationshipId,
      productId: foreignProduct.id, actor,
    })
  } catch { foreignPublish = true }
  check('cannot publish a product you do not own', foreignPublish)

  check('supplier sees its published catalogue',
    (await listPublishedCatalog({ supplierOrgId: 'org-a' })).length === 2)

  const browse = await browsePartnerCatalog({ buyerOrgId: 'org-b', relationshipId: r1.targetRelationshipId })
  check('buyer browses the supplier catalogue', browse.items.length === 2, browse.items.length)
  check('buyer sees supplier name', browse.supplierName === 'Alpha Consulting', browse.supplierName)
  const widgetRow = browse.items.find((i) => i.productId === widgetRef.id)
  check('buyer sees the negotiated price', widgetRow?.unitPrice === 85, widgetRow?.unitPrice)
  check('stock shows as a SIGNAL not a number', widgetRow?.stock === 'low_stock', widgetRow?.stock)
  check('no quantity leaks into the buyer view',
    !Object.prototype.hasOwnProperty.call(widgetRow ?? {}, 'quantityAvailable'))
  check('product with no inventory row reports unknown',
    browse.items.find((i) => i.productId === gadgetRef.id)?.stock === 'unknown')

  let outsiderBrowse = false
  try { await browsePartnerCatalog({ buyerOrgId: 'org-c', relationshipId: r1.targetRelationshipId }) } catch { outsiderBrowse = true }
  check('an unrelated org cannot browse the catalogue', outsiderBrowse)

  // Buyer places the order.
  const placed = await placePartnerOrder({
    buyerOrgId: 'org-b', relationshipId: r1.targetRelationshipId,
    lines: [{ catalogItemId: pub1.id, qty: 3 }], notes: 'Please ship this week.',
    actor: partnerActor,
  })
  check('order totals use the negotiated price', placed.total === 85 * 3 * 1.15,
    { total: placed.total, expected: 85 * 3 * 1.15 })

  const buyerOrder = await doc('orders', placed.buyerOrderId)
  const supplierOrder = await doc('orders', placed.supplierOrderId)
  check('buyer copy is a purchase order', buyerOrder.direction === 'purchase', buyerOrder.direction)
  check('supplier copy is a sales order', supplierOrder.direction === 'sales', supplierOrder.direction)
  check('both copies share a tradeOrderId',
    buyerOrder.tradeOrderId === supplierOrder.tradeOrderId && Boolean(buyerOrder.tradeOrderId))
  check('both start pending',
    buyerOrder.partnerOrderStatus === 'pending' && supplierOrder.partnerOrderStatus === 'pending')
  check('stock NOT reserved before confirmation',
    (await doc('inventoryItems', widgetStock.id)).quantityReserved === 0)

  let buyerCannotConfirm = false
  try {
    await decidePartnerOrder({ supplierOrgId: 'org-b', orderId: placed.buyerOrderId, decision: 'confirm', actor: partnerActor })
  } catch { buyerCannotConfirm = true }
  check('the buyer cannot confirm its own order', buyerCannotConfirm)

  const decided = await decidePartnerOrder({
    supplierOrgId: 'org-a', orderId: placed.supplierOrderId, decision: 'confirm', actor,
  })
  check('supplier confirmed', decided.status === 'confirmed', decided.status)

  const stockAfter = await doc('inventoryItems', widgetStock.id)
  check('stock reserved on confirmation', stockAfter.quantityReserved === 3, stockAfter.quantityReserved)
  check('available decremented', stockAfter.quantityAvailable === 5, stockAfter.quantityAvailable)

  const movements = await adminDb.collection('inventoryMovements')
    .where('orgId', '==', 'org-a').get()
  check('an inventory movement was logged',
    movements.docs.some((d) => d.data().movementType === 'reserved' && d.data().quantity === 3))

  check('BOTH copies flipped to confirmed',
    (await doc('orders', placed.buyerOrderId)).partnerOrderStatus === 'confirmed' &&
    (await doc('orders', placed.supplierOrderId)).partnerOrderStatus === 'confirmed')

  check('an invoice was drafted', Boolean(decided.invoiceId))
  const inv = await doc('invoices', decided.invoiceId!)
  check('invoice belongs to the SUPPLIER org', inv.orgId === 'org-a', inv.orgId)
  check('invoice is addressed to the buyer org', inv.recipientOrgId === 'org-b', inv.recipientOrgId)
  check('invoice is a draft', inv.status === 'draft', inv.status)
  check('invoice total matches the order', Math.abs(Number(inv.total) - placed.total) < 0.01,
    { invoice: inv.total, order: placed.total })

  check('supplier sees it in sales orders',
    (await listPartnerOrders({ orgId: 'org-a', direction: 'sales' })).length === 1)
  check('buyer sees it in purchase orders',
    (await listPartnerOrders({ orgId: 'org-b', direction: 'purchase' })).length === 1)

  let doubleDecide = false
  try {
    await decidePartnerOrder({ supplierOrgId: 'org-a', orderId: placed.supplierOrderId, decision: 'reject', actor })
  } catch { doubleDecide = true }
  check('an already-decided order cannot be decided again', doubleDecide)

  // Unpublishing blocks future orders but leaves history alone.
  await unpublishCatalogItem({ supplierOrgId: 'org-a', itemId: pub1.id, actor })
  let staleOrder = false
  try {
    await placePartnerOrder({
      buyerOrgId: 'org-b', relationshipId: r1.targetRelationshipId,
      lines: [{ catalogItemId: pub1.id, qty: 1 }], actor: partnerActor,
    })
  } catch { staleOrder = true }
  check('cannot order an unpublished item', staleOrder)
  check('the existing order survives unpublishing',
    (await doc('orders', placed.supplierOrderId)).partnerOrderStatus === 'confirmed')

  // =======================================================================
  console.log('\n[4h] Fulfilment: pack → ship → deliver, and cancellation')
  // =======================================================================
  const { fulfilPartnerOrder, cancelPartnerOrder, listPartnerShipments } =
    await import('@/lib/partner-links/trade')

  // The confirmed order from [4g] reserved 3 of the widget.
  check('reservation still standing before shipping',
    (await doc('inventoryItems', widgetStock.id)).quantityReserved === 3)

  let deliverTooEarly = false
  try {
    await fulfilPartnerOrder({ supplierOrgId: 'org-a', orderId: placed.supplierOrderId, action: 'deliver', actor })
  } catch { deliverTooEarly = true }
  check('cannot deliver before shipping', deliverTooEarly)

  let buyerCannotFulfil = false
  try {
    await fulfilPartnerOrder({ supplierOrgId: 'org-b', orderId: placed.buyerOrderId, action: 'ship', actor: partnerActor })
  } catch { buyerCannotFulfil = true }
  check('the buyer cannot fulfil', buyerCannotFulfil)

  await fulfilPartnerOrder({ supplierOrgId: 'org-a', orderId: placed.supplierOrderId, action: 'pack', actor })
  check('packing sets fulfillmentStatus',
    (await doc('orders', placed.supplierOrderId)).fulfillmentStatus === 'packed')
  check('packing does NOT consume stock',
    (await doc('inventoryItems', widgetStock.id)).quantityReserved === 3)

  const shipped = await fulfilPartnerOrder({
    supplierOrgId: 'org-a', orderId: placed.supplierOrderId, action: 'ship',
    carrier: 'Courier Co', trackingNumber: 'TRK-9', actor,
  })
  check('shipping clears the reservation',
    (await doc('inventoryItems', widgetStock.id)).quantityReserved === 0)
  check('available stock unchanged by shipping (already decremented)',
    (await doc('inventoryItems', widgetStock.id)).quantityAvailable === 5)
  check('a shipped movement was logged',
    (await adminDb.collection('inventoryMovements').where('orgId', '==', 'org-a').get())
      .docs.some((d) => d.data().movementType === 'shipped' && d.data().quantity === 3))
  check('mirrored shipments created for both sides', shipped.shipmentIds.length === 2, shipped.shipmentIds.length)
  check('buyer can see its own shipment row',
    (await listPartnerShipments('org-b')).some((s) => s.trackingNumber === 'TRK-9'))
  check('supplier can see its own shipment row',
    (await listPartnerShipments('org-a')).some((s) => s.carrier === 'Courier Co'))
  check('both order copies now in transit',
    (await doc('orders', placed.buyerOrderId)).fulfillmentStatus === 'in_transit' &&
    (await doc('orders', placed.supplierOrderId)).fulfillmentStatus === 'in_transit')

  let cancelAfterShip = false
  try { await cancelPartnerOrder({ orgId: 'org-a', orderId: placed.supplierOrderId, actor }) } catch { cancelAfterShip = true }
  check('a shipped order cannot be cancelled', cancelAfterShip)

  await fulfilPartnerOrder({ supplierOrgId: 'org-a', orderId: placed.supplierOrderId, action: 'deliver', actor })
  check('delivery marks both copies fulfilled',
    (await doc('orders', placed.buyerOrderId)).status === 'fulfilled' &&
    (await doc('orders', placed.supplierOrderId)).fulfillmentStatus === 'delivered')
  check('shipments marked delivered',
    (await listPartnerShipments('org-b')).every((s) => s.status === 'delivered'))

  // The invoice from [4g] should now be visible to the buyer via a system share.
  const buyerShares = await listIncomingShares('org-b')
  const invShare = buyerShares.find((s) => s.resourceType === 'invoice' && s.resourceId === decided.invoiceId)
  check('invoice auto-shared to the buyer', Boolean(invShare))
  check('the invoice share is view-only', invShare?.permission === 'view', invShare?.permission)
  const invView = await loadSharedRecord({ shareId: invShare!.id, viewerOrgId: 'org-b' })
  check('buyer can read the invoice total', Number(invView.record.total) > 0, invView.record.total)

  // --- Cancellation releases a reservation -------------------------------
  const gadgetStock = adminDb.collection('inventoryItems').doc()
  await gadgetStock.set({
    orgId: 'org-a', productId: gadgetRef.id, name: 'Red Gadget',
    quantityAvailable: 20, quantityReserved: 0, status: 'active',
    deleted: false, createdAt: now, updatedAt: now,
  })
  const gadgetCatalog = (await listPublishedCatalog({ supplierOrgId: 'org-a' }))
    .find((i) => i.productId === gadgetRef.id)!

  const order2 = await placePartnerOrder({
    buyerOrgId: 'org-b', relationshipId: r1.targetRelationshipId,
    lines: [{ catalogItemId: gadgetCatalog.id, qty: 4 }], actor: partnerActor,
  })
  check('buyer may cancel while still pending',
    Boolean(await cancelPartnerOrder({ orgId: 'org-b', orderId: order2.buyerOrderId, actor: partnerActor })))
  check('cancelled pending order touched no stock',
    (await doc('inventoryItems', gadgetStock.id)).quantityReserved === 0)

  const order3 = await placePartnerOrder({
    buyerOrgId: 'org-b', relationshipId: r1.targetRelationshipId,
    lines: [{ catalogItemId: gadgetCatalog.id, qty: 4 }], actor: partnerActor,
  })
  await decidePartnerOrder({ supplierOrgId: 'org-a', orderId: order3.supplierOrderId, decision: 'confirm', actor })
  check('confirmation reserved 4 gadgets',
    (await doc('inventoryItems', gadgetStock.id)).quantityReserved === 4)

  let buyerCannotCancelConfirmed = false
  try { await cancelPartnerOrder({ orgId: 'org-b', orderId: order3.buyerOrderId, actor: partnerActor }) } catch { buyerCannotCancelConfirmed = true }
  check('buyer cannot cancel once confirmed', buyerCannotCancelConfirmed)

  const released = await cancelPartnerOrder({ orgId: 'org-a', orderId: order3.supplierOrderId, actor })
  check('supplier cancellation released the reservation',
    (await doc('inventoryItems', gadgetStock.id)).quantityReserved === 0)
  check('released stock returned to available',
    (await doc('inventoryItems', gadgetStock.id)).quantityAvailable === 20,
    (await doc('inventoryItems', gadgetStock.id)).quantityAvailable)
  check('a released movement was logged', released.releasedInventoryIds.length === 1)
  check('both copies cancelled',
    (await doc('orders', order3.buyerOrderId)).partnerOrderStatus === 'cancelled' &&
    (await doc('orders', order3.supplierOrderId)).partnerOrderStatus === 'cancelled')

  // =======================================================================
  console.log('\n[4i] Partial shipment')
  // =======================================================================
  const splitStock = adminDb.collection('inventoryItems').doc()
  await splitStock.set({
    orgId: 'org-a', productId: gadgetRef.id, name: 'Red Gadget split',
    quantityAvailable: 0, quantityReserved: 0, status: 'active',
    deleted: false, createdAt: now, updatedAt: now,
  })
  await adminDb.collection('inventoryItems').doc(gadgetStock.id).set(
    { quantityAvailable: 20, quantityReserved: 0 }, { merge: true })

  const splitOrder = await placePartnerOrder({
    buyerOrgId: 'org-b', relationshipId: r1.targetRelationshipId,
    lines: [{ catalogItemId: gadgetCatalog.id, qty: 10 }], actor: partnerActor,
  })
  await decidePartnerOrder({ supplierOrgId: 'org-a', orderId: splitOrder.supplierOrderId, decision: 'confirm', actor })
  check('10 reserved for the split order',
    (await doc('inventoryItems', gadgetStock.id)).quantityReserved === 10)

  await fulfilPartnerOrder({
    supplierOrgId: 'org-a', orderId: splitOrder.supplierOrderId, action: 'ship',
    quantities: { [gadgetRef.id]: 4 }, trackingNumber: 'PART-1', actor,
  })
  const afterPartial = await doc('orders', splitOrder.supplierOrderId)
  check('partial shipment records shipped quantity',
    (afterPartial.shippedQuantities ?? {})[gadgetRef.id] === 4,
    afterPartial.shippedQuantities)
  check('order stays packed while a remainder is outstanding',
    afterPartial.fulfillmentStatus === 'packed', afterPartial.fulfillmentStatus)
  check('only the shipped portion left the reservation',
    (await doc('inventoryItems', gadgetStock.id)).quantityReserved === 6,
    (await doc('inventoryItems', gadgetStock.id)).quantityReserved)

  // Over-shipping is clamped to what remains.
  await fulfilPartnerOrder({
    supplierOrgId: 'org-a', orderId: splitOrder.supplierOrderId, action: 'ship',
    quantities: { [gadgetRef.id]: 999 }, actor,
  })
  const afterRest = await doc('orders', splitOrder.supplierOrderId)
  check('over-shipping is clamped to the outstanding amount',
    (afterRest.shippedQuantities ?? {})[gadgetRef.id] === 10,
    afterRest.shippedQuantities)
  check('order moves to in_transit once fully shipped',
    afterRest.fulfillmentStatus === 'in_transit', afterRest.fulfillmentStatus)
  check('reservation fully consumed',
    (await doc('inventoryItems', gadgetStock.id)).quantityReserved === 0)

  // =======================================================================
  console.log('\n[4i-b] Stock spanning several inventory rows')
  // =======================================================================
  // A product held in two locations must reserve across BOTH, not just the
  // first row found. splitStock (0) sorts alongside gadgetStock (20).
  await adminDb.collection('inventoryItems').doc(splitStock.id).set(
    { quantityAvailable: 3, quantityReserved: 0 }, { merge: true })
  await adminDb.collection('inventoryItems').doc(gadgetStock.id).set(
    { quantityAvailable: 5, quantityReserved: 0 }, { merge: true })

  const multiOrder = await placePartnerOrder({
    buyerOrgId: 'org-b', relationshipId: r1.targetRelationshipId,
    lines: [{ catalogItemId: gadgetCatalog.id, qty: 7 }], actor: partnerActor,
  })
  await decidePartnerOrder({ supplierOrgId: 'org-a', orderId: multiOrder.supplierOrderId, decision: 'confirm', actor })

  const rowA = await doc('inventoryItems', splitStock.id)
  const rowB = await doc('inventoryItems', gadgetStock.id)
  const totalReserved = (Number(rowA.quantityReserved) || 0) + (Number(rowB.quantityReserved) || 0)
  const totalAvailable = (Number(rowA.quantityAvailable) || 0) + (Number(rowB.quantityAvailable) || 0)
  check('reservation drains across both inventory rows', totalReserved === 7,
    { rowA: rowA.quantityReserved, rowB: rowB.quantityReserved })
  check('available reduced by exactly the reserved amount', totalAvailable === 1, totalAvailable)

  await cancelPartnerOrder({ orgId: 'org-a', orderId: multiOrder.supplierOrderId, actor })
  const backA = await doc('inventoryItems', splitStock.id)
  const backB = await doc('inventoryItems', gadgetStock.id)
  check('cancellation returns stock across both rows',
    (Number(backA.quantityAvailable) || 0) + (Number(backB.quantityAvailable) || 0) === 8,
    { a: backA.quantityAvailable, b: backB.quantityAvailable })
  check('no reservation left behind',
    (Number(backA.quantityReserved) || 0) + (Number(backB.quantityReserved) || 0) === 0)

  // All-or-nothing reservation: confirmation must fail before any stock mutation
  // or invoice when the supplier cannot reserve every requested unit.
  const overMovementsBefore = (await adminDb.collection('inventoryMovements').get()).docs.length
  const overInvoicesBefore = (await adminDb.collection('invoices').get()).docs.length
  const overOrder = await placePartnerOrder({
    buyerOrgId: 'org-b', relationshipId: r1.targetRelationshipId,
    lines: [{ catalogItemId: gadgetCatalog.id, qty: 100 }], actor: partnerActor,
  })
  let overOrderRejected = false
  try {
    await decidePartnerOrder({ supplierOrgId: 'org-a', orderId: overOrder.supplierOrderId, decision: 'confirm', actor })
  } catch { overOrderRejected = true }
  const overA = await doc('inventoryItems', splitStock.id)
  const overB = await doc('inventoryItems', gadgetStock.id)
  check('over-ordering is rejected when the full quantity cannot be reserved', overOrderRejected)
  check('over-order rejection leaves inventory unchanged',
    (Number(overA.quantityAvailable) || 0) + (Number(overB.quantityAvailable) || 0) === 8 &&
    (Number(overA.quantityReserved) || 0) + (Number(overB.quantityReserved) || 0) === 0)
  check('over-order rejection leaves the pair pending',
    (await doc('orders', overOrder.supplierOrderId)).partnerOrderStatus === 'pending')
  check('over-order rejection creates no movement or invoice',
    (await adminDb.collection('inventoryMovements').get()).docs.length === overMovementsBefore &&
    (await adminDb.collection('invoices').get()).docs.length === overInvoicesBefore)

  // Reset for the sections that follow.
  await adminDb.collection('inventoryItems').doc(splitStock.id).set(
    { quantityAvailable: 0, quantityReserved: 0, deleted: true }, { merge: true })
  await adminDb.collection('inventoryItems').doc(gadgetStock.id).set(
    { quantityAvailable: 20, quantityReserved: 0 }, { merge: true })

  // =======================================================================
  console.log('\n[4j] Cross-org project access')
  // =======================================================================
  const {
    grantPartnerProjectAccess, revokePartnerProjectAccess, listPartnerProjects,
    postPartnerMessage, listPartnerMessages, loadPartnerOverview,
  } = await import('@/lib/partner-links/collaboration')

  const sharedProject = adminDb.collection('projects').doc()
  await sharedProject.set({
    orgId: 'org-a', name: 'Joint Delivery Programme', status: 'active',
    deleted: false, createdAt: now, updatedAt: now,
  })
  await adminDb.collection('projectMembers').doc(`${sharedProject.id}_${actor.uid}`).set({
    projectId: sharedProject.id, userId: actor.uid, orgId: 'org-a', role: 'manager', status: 'active',
    createdAt: now, updatedAt: now,
  })

  const preProjectScope = await doc('partnerScopeAgreements', invoiceScopeId)
  check('project scope fixture remains canonical', preProjectScope.status === 'active' &&
    preProjectScope.partnerLinkId === r1.partnerLinkId && Array.isArray(preProjectScope.capabilities) &&
    preProjectScope.capabilities.includes('projects') && preProjectScope.acceptance?.grantor && preProjectScope.acceptance?.grantee,
  preProjectScope)

  const granted = await grantPartnerProjectAccess({
    ownerOrgId: 'org-a', relationshipId: r1.sourceRelationshipId,
    projectId: sharedProject.id, role: 'contributor', actor,
  })
  check('project access granted to the partner org', granted.orgId === 'org-b', granted.orgId)
  check('access row uses the standard projectOrganizations id',
    granted.id === `${sharedProject.id}_org-b`, granted.id)

  const escalated = await grantPartnerProjectAccess({
    ownerOrgId: 'org-a', relationshipId: r1.sourceRelationshipId,
    projectId: sharedProject.id, role: 'owner', actor,
  })
  check('a partner is never given owner rights', escalated.role === 'contributor', escalated.role)

  let foreignProject = false
  try {
    await grantPartnerProjectAccess({
      ownerOrgId: 'org-a', relationshipId: r1.sourceRelationshipId,
      projectId: otherProj.id === sharedProject.id ? foreignRef.id : foreignRef.id, actor,
    })
  } catch { foreignProject = true }
  check('cannot share a project you do not own', foreignProject)

  const aProjects = await listPartnerProjects('org-a')
  const bProjects = await listPartnerProjects('org-b')
  check('owner sees it as shared out', aProjects.sharedOut.some((p) => p.projectId === sharedProject.id))
  check('partner sees it as shared with them',
    bProjects.sharedWithMe.some((p) => p.projectId === sharedProject.id))
  check('owner does not see own grant as inbound',
    !aProjects.sharedWithMe.some((p) => p.projectId === sharedProject.id))

  await revokePartnerProjectAccess({
    ownerOrgId: 'org-a', projectId: sharedProject.id, partnerOrgId: 'org-b', actor,
  })
  check('revoked access disappears for the partner',
    !(await listPartnerProjects('org-b')).sharedWithMe.some((p) => p.projectId === sharedProject.id))

  // Re-grant so [5] can prove unlink tears it down.
  await grantPartnerProjectAccess({
    ownerOrgId: 'org-a', relationshipId: r1.sourceRelationshipId,
    projectId: sharedProject.id, actor,
  })

  // =======================================================================
  console.log('\n[4k] Relationship conversation + overview')
  // =======================================================================
  await postPartnerMessage({
    relationshipId: r1.sourceRelationshipId, orgId: 'org-a',
    body: 'Welcome aboard — anything you need?', actor,
  })
  await postPartnerMessage({
    relationshipId: r1.targetRelationshipId, orgId: 'org-b',
    body: 'Thanks! Sending our first order shortly.', actor: partnerActor,
  })

  const threadA = await listPartnerMessages({ relationshipId: r1.sourceRelationshipId, orgId: 'org-a' })
  const threadB = await listPartnerMessages({ relationshipId: r1.targetRelationshipId, orgId: 'org-b' })
  check('both sides read the same thread', threadA.messages.length === 2 && threadB.messages.length === 2,
    { a: threadA.messages.length, b: threadB.messages.length })
  check('thread is chronological', threadA.messages[0].body.startsWith('Welcome'))
  check('author org recorded', threadA.messages[1].authorOrgId === 'org-b')

  let outsiderThread = false
  try { await listPartnerMessages({ relationshipId: r1.sourceRelationshipId, orgId: 'org-c' }) } catch { outsiderThread = true }
  check('an unrelated org cannot read the thread', outsiderThread)

  let emptyMessage = false
  try {
    await postPartnerMessage({ relationshipId: r1.sourceRelationshipId, orgId: 'org-a', body: '  ', actor })
  } catch { emptyMessage = true }
  check('empty message rejected', emptyMessage)

  const overview = await loadPartnerOverview({ orgId: 'org-a', relationshipId: r1.sourceRelationshipId })
  check('overview resolves the partner org', overview.partnerOrgName === 'Beta Manufacturing', overview.partnerOrgName)
  check('overview counts the catalogue', overview.counts.catalogItems >= 1, overview.counts.catalogItems)
  check('overview counts orders received', overview.counts.ordersReceived >= 1, overview.counts.ordersReceived)
  check('overview counts the shared project', overview.counts.projectsSharedOut === 1, overview.counts.projectsSharedOut)
  check('overview counts messages', overview.counts.messages === 2, overview.counts.messages)
  check('overview reports confirmed trade value', overview.tradeValue.received > 0, overview.tradeValue)
  check('overview returns recent messages', overview.recentMessages.length === 2)

  const overviewB = await loadPartnerOverview({ orgId: 'org-b', relationshipId: r1.targetRelationshipId })
  check('buyer overview counts orders placed', overviewB.counts.ordersPlaced >= 1, overviewB.counts.ordersPlaced)
  check('buyer overview sees the project shared with it',
    overviewB.counts.projectsSharedWithMe === 1, overviewB.counts.projectsSharedWithMe)

  // =======================================================================
  console.log('\n[4l] Settlement: buyer pays, supplier verifies')
  // =======================================================================
  const { recordPartnerPayment, decidePartnerPayment, listPartnerSettlements } =
    await import('@/lib/partner-links/settlement')

  const tradeInvoiceId = decided.invoiceId!

  // Only the recipient may record a payment, only the issuer may verify.
  const tradeInvoiceSnapshot = await doc('invoices', tradeInvoiceId)
  const tradeInvoiceTotal = Number(tradeInvoiceSnapshot.total)
  // Missing either acceptance side is not a capability, even when the row is
  // otherwise marked active. Restore the bilateral decision before next check.
  await adminDb.collection('partnerScopeAgreements').doc(invoiceScopeId).set({ acceptance: {} }, { merge: true })
  let unacceptedScopeRejected = false
  try {
    await recordPartnerPayment({ payerOrgId: 'org-b', invoiceId: tradeInvoiceId, reference: 'UNACCEPTED', amount: tradeInvoiceTotal, idempotencyKey: 'unaccepted-scope', actor: partnerActor })
  } catch { unacceptedScopeRejected = true }
  check('settlement rejects a one-sided directional invoices capability', unacceptedScopeRejected)
  await adminDb.collection('partnerScopeAgreements').doc(invoiceScopeId).set({
    acceptance: { grantor: { byRef: actor, at: now }, grantee: { byRef: partnerActor, at: now } },
  }, { merge: true })

  // Fail closed when the negotiated direction is absent, then restore the
  // signed capability before exercising the normal payment flow.
  await adminDb.collection('partnerScopeAgreements').doc(invoiceScopeId).set({ status: 'paused' }, { merge: true })
  let pausedScopeRejected = false
  try {
    await recordPartnerPayment({ payerOrgId: 'org-b', invoiceId: tradeInvoiceId, reference: 'PAUSED', amount: tradeInvoiceTotal, idempotencyKey: 'paused-scope', actor: partnerActor })
  } catch { pausedScopeRejected = true }
  check('settlement rejects a paused directional invoices capability', pausedScopeRejected)
  await adminDb.collection('partnerScopeAgreements').doc(invoiceScopeId).set({ status: 'active' }, { merge: true })

  await adminDb.collection('invoices').doc(tradeInvoiceId).set({ buyerOrderId: 'tampered-pair' }, { merge: true })
  let tamperedPairRejected = false
  try {
    await recordPartnerPayment({ payerOrgId: 'org-b', invoiceId: tradeInvoiceId, reference: 'TAMPERED', amount: tradeInvoiceTotal, idempotencyKey: 'tampered-pair', actor: partnerActor })
  } catch { tamperedPairRejected = true }
  check('settlement rejects a tampered immutable invoice/order pair', tamperedPairRejected)
  await adminDb.collection('invoices').doc(tradeInvoiceId).set({ buyerOrderId: placed.buyerOrderId }, { merge: true })

  const alteredLineItems = Array.isArray(tradeInvoiceSnapshot.lineItems)
    ? tradeInvoiceSnapshot.lineItems.map((line: Record<string, unknown>, index: number) => index === 0
      ? { ...line, productId: 'tampered-same-total-product' }
      : line)
    : []
  await adminDb.collection('invoices').doc(tradeInvoiceId).set({ lineItems: alteredLineItems }, { merge: true })
  let tamperedFinancialTermsRejected = false
  try {
    await recordPartnerPayment({ payerOrgId: 'org-b', invoiceId: tradeInvoiceId, reference: 'TAMPERED-TERMS', amount: tradeInvoiceTotal, idempotencyKey: 'tampered-financial-terms', actor: partnerActor })
  } catch { tamperedFinancialTermsRejected = true }
  check('settlement rejects same-total tampered financial line terms', tamperedFinancialTermsRejected)
  await adminDb.collection('invoices').doc(tradeInvoiceId).set({ lineItems: tradeInvoiceSnapshot.lineItems }, { merge: true })

  let issuerCannotPay = false
  try {
    await recordPartnerPayment({ payerOrgId: 'org-a', invoiceId: tradeInvoiceId, reference: 'X', amount: tradeInvoiceTotal, idempotencyKey: 'wrong-payer', actor })
  } catch { issuerCannotPay = true }
  check('the issuer cannot record a payment against its own invoice', issuerCannotPay)

  let outsiderPay = false
  try {
    await recordPartnerPayment({ payerOrgId: 'org-c', invoiceId: tradeInvoiceId, reference: 'X', amount: tradeInvoiceTotal, idempotencyKey: 'outside-payer', actor })
  } catch { outsiderPay = true }
  check('an unrelated org cannot pay the invoice', outsiderPay)

  let noEvidence = false
  try {
    await recordPartnerPayment({ payerOrgId: 'org-b', invoiceId: tradeInvoiceId, amount: tradeInvoiceTotal, idempotencyKey: 'no-evidence', actor: partnerActor })
  } catch { noEvidence = true }
  check('a payment needs a reference or proof file', noEvidence)

  let verifyBeforePay = false
  try {
    await decidePartnerPayment({ issuerOrgId: 'org-a', invoiceId: tradeInvoiceId, decision: 'confirm', idempotencyKey: 'before-notice', actor })
  } catch { verifyBeforePay = true }
  check('cannot verify before anything is submitted', verifyBeforePay)

  const paid = await recordPartnerPayment({
    payerOrgId: 'org-b', invoiceId: tradeInvoiceId, reference: 'EFT-55123', amount: tradeInvoiceTotal,
    note: 'Paid via EFT today.', idempotencyKey: 'notice-55123', actor: partnerActor,
  })
  check('payment moves the invoice to pending verification', paid.paymentState === 'pending_verification', paid.paymentState)
  check('invoice status reflects pending verification',
    (await doc('invoices', tradeInvoiceId)).status === 'payment_pending_verification')
  check('payment state mirrored onto both order copies', paid.orderIds.length === 2, paid.orderIds)
  check('buyer order shows pending verification',
    (await doc('orders', placed.buyerOrderId)).paymentState === 'pending_verification')
  const paidRetry = await recordPartnerPayment({
    payerOrgId: 'org-b', invoiceId: tradeInvoiceId, reference: 'EFT-55123', amount: tradeInvoiceTotal,
    note: 'Paid via EFT today.', idempotencyKey: 'notice-55123', actor: partnerActor,
  })
  check('same payment notice key replays idempotently', paidRetry.idempotent === true && paidRetry.reconciliationKey === paid.reconciliationKey)
  check('payment notice writes canonical finance audit evidence exactly once',
    (await adminDb.collection('partnerAuditEvents').where('reconciliationKey', '==', paid.reconciliationKey).get()).size === 1)

  let doublePay = false
  try {
    await recordPartnerPayment({ payerOrgId: 'org-b', invoiceId: tradeInvoiceId, reference: 'again', amount: tradeInvoiceTotal, idempotencyKey: 'different-notice', actor: partnerActor })
  } catch { doublePay = true }
  check('cannot submit a second payment while one is pending', doublePay)

  let buyerCannotVerify = false
  try {
    await decidePartnerPayment({ issuerOrgId: 'org-b', invoiceId: tradeInvoiceId, decision: 'confirm', idempotencyKey: 'buyer-confirm', actor: partnerActor })
  } catch { buyerCannotVerify = true }
  check('the buyer cannot verify their own payment', buyerCannotVerify)

  // Reject first, so the invoice returns to outstanding.
  await decidePartnerPayment({
    issuerOrgId: 'org-a', invoiceId: tradeInvoiceId, decision: 'reject',
    note: 'Reference not found on our statement.', idempotencyKey: 'dispute-55123', actor,
  })
  const rejectedInvoice = await doc('invoices', tradeInvoiceId)
  check('rejection returns the invoice to sent', rejectedInvoice.status === 'sent', rejectedInvoice.status)
  check('rejection is NOT marked paid', rejectedInvoice.paidAt === undefined)
  check('rejection note retained',
    (rejectedInvoice.partnerPayment ?? {}).decisionNote === 'Reference not found on our statement.')
  check('orders reflect the rejection',
    (await doc('orders', placed.buyerOrderId)).paymentState === 'rejected')
  check('settlement summary retains rejected state',
    (await listPartnerSettlements('org-a')).receivable.find((i) => i.id === tradeInvoiceId)?.paymentState === 'rejected')

  // Buyer resubmits, supplier confirms.
  await recordPartnerPayment({
    payerOrgId: 'org-b', invoiceId: tradeInvoiceId, reference: 'EFT-55999', amount: tradeInvoiceTotal,
    idempotencyKey: 'notice-55999', actor: partnerActor,
  })
  const settled = await decidePartnerPayment({
    issuerOrgId: 'org-a', invoiceId: tradeInvoiceId, decision: 'confirm', idempotencyKey: 'confirm-55999', actor,
  })
  check('confirmation settles the invoice', settled.paymentState === 'paid', settled.paymentState)
  const settledRetry = await decidePartnerPayment({
    issuerOrgId: 'org-a', invoiceId: tradeInvoiceId, decision: 'confirm', idempotencyKey: 'confirm-55999', actor,
  })
  check('same confirmation key replays idempotently', settledRetry.idempotent === true && settledRetry.reconciliationKey === settled.reconciliationKey)
  const paidInvoice = await doc('invoices', tradeInvoiceId)
  check('invoice marked paid', paidInvoice.status === 'paid', paidInvoice.status)
  check('paidAt stamped', Boolean(paidInvoice.paidAt))
  check('both orders show paid',
    (await doc('orders', placed.buyerOrderId)).paymentState === 'paid' &&
    (await doc('orders', placed.supplierOrderId)).paymentState === 'paid')

  let payAfterSettled = false
  try {
    await recordPartnerPayment({ payerOrgId: 'org-b', invoiceId: tradeInvoiceId, reference: 'late', amount: tradeInvoiceTotal, idempotencyKey: 'after-settle', actor: partnerActor })
  } catch { payAfterSettled = true }
  check('cannot pay an already-settled invoice', payAfterSettled)

  const aBooks = await listPartnerSettlements('org-a')
  const bBooks = await listPartnerSettlements('org-b')
  check('supplier sees it as receivable', aBooks.receivable.some((i) => i.id === tradeInvoiceId))
  check('supplier has no payable for it', !aBooks.payable.some((i) => i.id === tradeInvoiceId))
  check('buyer sees it as payable', bBooks.payable.some((i) => i.id === tradeInvoiceId))
  check('buyer has no receivable for it', !bBooks.receivable.some((i) => i.id === tradeInvoiceId))
  check('settlement summary reports paid',
    aBooks.receivable.find((i) => i.id === tradeInvoiceId)?.paymentState === 'paid')

  // A non-trade invoice must not appear in partner settlement books at all.
  const plainInvoice = adminDb.collection('invoices').doc()
  await plainInvoice.set({
    orgId: 'org-a', recipientOrgId: 'org-b', invoiceNumber: 'PLAIN-1',
    status: 'sent', total: 10, currency: 'ZAR', deleted: false, createdAt: now, updatedAt: now,
  })
  check('an invoice with no tradeOrderId is excluded from partner books',
    !(await listPartnerSettlements('org-a')).receivable.some((i) => i.id === plainInvoice.id))
  let plainPay = false
  try {
    await recordPartnerPayment({ payerOrgId: 'org-b', invoiceId: plainInvoice.id, reference: 'x', amount: 10, idempotencyKey: 'plain-invoice', actor: partnerActor })
  } catch { plainPay = true }
  check('a non-trade invoice cannot be settled through the partner flow', plainPay)

  // =======================================================================
  console.log('\n[4m] Duplicate catalogue lines are canonicalised before persistence')
  // =======================================================================
  // Two lines for the same catalogue item collapse into ONE persisted line
  // (aggregated quantity) so confirm cannot double-reserve against the same
  // product snapshot and shippedQuantities stays product-key cardinality-safe.
  const dupStock = adminDb.collection('inventoryItems').doc()
  await dupStock.set({
    orgId: 'org-a', productId: gadgetRef.id, name: 'Red Gadget dup',
    quantityAvailable: 30, quantityReserved: 0, status: 'active',
    deleted: false, createdAt: now, updatedAt: now,
  })

  // Stock for a product can span several rows, so reservations drain across
  // ALL matching rows; read totals instead of one row.
  const reservedTotalFor = async (productId: string) => {
    const snap = await adminDb.collection('inventoryItems').where('orgId', '==', 'org-a').get()
    return snap.docs
      .filter((d) => (d.data() ?? {}).productId === productId && (d.data() ?? {}).deleted !== true)
      .reduce((sum, d) => sum + (Number(d.data()?.quantityReserved) || 0), 0)
  }

  const dupOrder = await placePartnerOrder({
    buyerOrgId: 'org-b', relationshipId: r1.targetRelationshipId,
    lines: [
      { catalogItemId: gadgetCatalog.id, qty: 2 },
      { catalogItemId: gadgetCatalog.id, qty: 3 },
    ],
    actor: partnerActor,
  })
  const dupLines = (await doc('orders', dupOrder.supplierOrderId)).lineItems as DealLineItem[]
  check('duplicate catalogue lines aggregate into one persisted line',
    dupLines.length === 1 && dupLines[0].qty === 5, dupLines)

  const dupReservedBefore = await reservedTotalFor(gadgetRef.id)
  await decidePartnerOrder({
    supplierOrgId: 'org-a', orderId: dupOrder.supplierOrderId, decision: 'confirm', actor,
  })
  check('confirm reserves the aggregated quantity ONCE',
    (await reservedTotalFor(gadgetRef.id)) === dupReservedBefore + 5,
    { before: dupReservedBefore, after: await reservedTotalFor(gadgetRef.id) })

  const dupMovements = await adminDb.collection('inventoryMovements')
    .where('orderId', '==', dupOrder.supplierOrderId).where('movementType', '==', 'reserved').get()
  check('exactly one reserved movement per canonical product line',
    dupMovements.docs.length === 1 && dupMovements.docs[0].data().quantity === 5,
    dupMovements.docs.map((d) => d.data().quantity))

  // Partial shipment of the canonicalised order works off the one product key.
  await fulfilPartnerOrder({
    supplierOrgId: 'org-a', orderId: dupOrder.supplierOrderId, action: 'ship',
    quantities: { [gadgetRef.id]: 2 }, trackingNumber: 'DUP-1', actor,
  })
  check('partial ship works on a canonicalised order',
    (await doc('orders', dupOrder.supplierOrderId)).shippedQuantities?.[gadgetRef.id] === 2)

  // =======================================================================
  console.log('\n[4n] Concurrency: double-confirm and confirm-vs-cancel')
  // =======================================================================
  const raceOrder = await placePartnerOrder({
    buyerOrgId: 'org-b', relationshipId: r1.targetRelationshipId,
    lines: [{ catalogItemId: gadgetCatalog.id, qty: 4 }], actor: partnerActor,
  })

  const raceReservedBefore = await reservedTotalFor(gadgetRef.id)
  const confirmOutcomes = await Promise.allSettled([
    decidePartnerOrder({ supplierOrgId: 'org-a', orderId: raceOrder.supplierOrderId, decision: 'confirm', actor }),
    decidePartnerOrder({ supplierOrgId: 'org-a', orderId: raceOrder.supplierOrderId, decision: 'confirm', actor }),
  ])
  const confirmWins = confirmOutcomes.filter((o) => o.status === 'fulfilled').length
  check('concurrent double-confirm: exactly one wins', confirmWins === 1, confirmOutcomes.map((o) => o.status))
  check('the loser gets a clean "already" error',
    confirmOutcomes.some((o) => o.status === 'rejected' && /already confirmed/i.test(String((o as PromiseRejectedResult).reason?.message ?? (o as PromiseRejectedResult).reason))))

  const raceReserved = await reservedTotalFor(gadgetRef.id)
  check('double-confirm reserved stock exactly once', raceReserved === raceReservedBefore + 4,
    { before: raceReservedBefore, after: raceReserved })
  const raceInvoices = await adminDb.collection('invoices')
    .where('tradeOrderId', '==', raceOrder.tradeOrderId).get()
  check('double-confirm drafted exactly one invoice', raceInvoices.docs.length === 1, raceInvoices.docs.length)
  check('the order stays confirmed after the race',
    (await doc('orders', raceOrder.supplierOrderId)).partnerOrderStatus === 'confirmed')

  // Confirm racing a supplier cancel on a fresh order: legal final states are
  // (confirm then cancel-releases) or (cancel first, confirm refused) — the
  // invariant is that the order always ends cancelled with zero reservation
  // and no negative stock.
  const race2 = await placePartnerOrder({
    buyerOrgId: 'org-b', relationshipId: r1.targetRelationshipId,
    lines: [{ catalogItemId: gadgetCatalog.id, qty: 3 }], actor: partnerActor,
  })
  const race2ReservedBefore = await reservedTotalFor(gadgetRef.id)
  await Promise.allSettled([
    decidePartnerOrder({ supplierOrgId: 'org-a', orderId: race2.supplierOrderId, decision: 'confirm', actor }),
    cancelPartnerOrder({ orgId: 'org-a', orderId: race2.supplierOrderId, actor }),
  ])
  const race2Order = await doc('orders', race2.supplierOrderId)
  const race2Reserved = await reservedTotalFor(gadgetRef.id)
  const race2Available = (await adminDb.collection('inventoryItems').where('orgId', '==', 'org-a').get()).docs
    .filter((d) => (d.data() ?? {}).productId === gadgetRef.id && (d.data() ?? {}).deleted !== true)
    .reduce((sum, d) => sum + (Number(d.data()?.quantityAvailable) || 0), 0)
  check('confirm-vs-cancel race always ends cancelled', race2Order.partnerOrderStatus === 'cancelled', race2Order.partnerOrderStatus)
  check('confirm-vs-cancel race leaves no net reservation', race2Reserved === race2ReservedBefore,
    { before: race2ReservedBefore, after: race2Reserved })
  check('confirm-vs-cancel race never goes negative', race2Available >= 0, race2Available)
  check('BOTH copies agree after confirm-vs-cancel race',
    (await doc('orders', race2.buyerOrderId)).partnerOrderStatus === 'cancelled')

  // =======================================================================
  console.log('\n[4o] Payment race: concurrent pay, and pay-vs-confirm')
  // =======================================================================
  const payRaceOrder = await placePartnerOrder({
    buyerOrgId: 'org-b', relationshipId: r1.targetRelationshipId,
    lines: [{ catalogItemId: gadgetCatalog.id, qty: 2 }], actor: partnerActor,
  })
  await decidePartnerOrder({ supplierOrgId: 'org-a', orderId: payRaceOrder.supplierOrderId, decision: 'confirm', actor })
  const payRaceInvoice = (await doc('orders', payRaceOrder.supplierOrderId)).invoiceId as string
  const payRaceTotal = Number((await doc('invoices', payRaceInvoice)).total)

  const payOutcomes = await Promise.allSettled([
    recordPartnerPayment({ payerOrgId: 'org-b', invoiceId: payRaceInvoice, reference: 'RACE-1', amount: payRaceTotal, idempotencyKey: 'race-notice-1', actor: partnerActor }),
    recordPartnerPayment({ payerOrgId: 'org-b', invoiceId: payRaceInvoice, reference: 'RACE-2', amount: payRaceTotal, idempotencyKey: 'race-notice-2', actor: partnerActor }),
  ])
  const payWins = payOutcomes.filter((o) => o.status === 'fulfilled').length
  check('concurrent double-pay: exactly one wins', payWins === 1, payOutcomes.map((o) => o.status))
  check('the losing pay gets a clean pending error',
    payOutcomes.some((o) => o.status === 'rejected' && /awaiting verification/i.test(String((o as PromiseRejectedResult).reason?.message ?? (o as PromiseRejectedResult).reason))))
  check('invoice is pending verification after the pay race',
    (await doc('invoices', payRaceInvoice)).status === 'payment_pending_verification')

  // Verification racing a fresh pay submission (after a reject resets status).
  await decidePartnerPayment({ issuerOrgId: 'org-a', invoiceId: payRaceInvoice, decision: 'reject', note: 'reset', idempotencyKey: 'race-dispute-reset', actor })
  await Promise.allSettled([
    recordPartnerPayment({ payerOrgId: 'org-b', invoiceId: payRaceInvoice, reference: 'RACE-3', amount: payRaceTotal, idempotencyKey: 'race-notice-3', actor: partnerActor }),
    decidePartnerPayment({ issuerOrgId: 'org-a', invoiceId: payRaceInvoice, decision: 'confirm', idempotencyKey: 'race-confirm', actor }),
  ])
  const finalInvoice = await doc('invoices', payRaceInvoice)
  check('pay-vs-confirm race settles to a consistent state',
    ['payment_pending_verification', 'paid'].includes(finalInvoice.status), finalInvoice.status)
  check('both order copies mirror the SAME payment state after the race',
    (await doc('orders', payRaceOrder.buyerOrderId)).paymentState === (await doc('orders', payRaceOrder.supplierOrderId)).paymentState)

  // =======================================================================
  console.log('\n[4p] Pre-unlink orders for post-unlink mutation checks')
  // =======================================================================
  const preUnlinkReservedBefore = await reservedTotalFor(gadgetRef.id)
  // A PENDING order (no stock touched yet) …
  const preUnlinkPending = await placePartnerOrder({
    buyerOrgId: 'org-b', relationshipId: r1.targetRelationshipId,
    lines: [{ catalogItemId: gadgetCatalog.id, qty: 2 }], actor: partnerActor,
  })
  // … and a CONFIRMED order with a drafted invoice (stock reserved).
  const preUnlinkConfirmed = await placePartnerOrder({
    buyerOrgId: 'org-b', relationshipId: r1.targetRelationshipId,
    lines: [{ catalogItemId: gadgetCatalog.id, qty: 3 }], actor: partnerActor,
  })
  const preUnlinkDecision = await decidePartnerOrder({
    supplierOrgId: 'org-a', orderId: preUnlinkConfirmed.supplierOrderId, decision: 'confirm', actor,
  })
  const preUnlinkReservedAfter = await reservedTotalFor(gadgetRef.id)
  check('pre-unlink confirmed order reserved stock',
    preUnlinkReservedAfter === preUnlinkReservedBefore + 3,
    { before: preUnlinkReservedBefore, after: preUnlinkReservedAfter })

  // =======================================================================
  console.log('\n[5] Unlink from the accepting side')
  // =======================================================================
  const unlinked = await unlinkPartnership({
    relationshipId: r1.targetRelationshipId, actingOrgId: 'org-b', actor,
  })
  const reservedAfterUnlink = await reservedTotalFor(gadgetRef.id)
  check('both relationship rows revoked', unlinked.revokedRelationshipIds.length === 2,
    unlinked.revokedRelationshipIds)
  check('unlink cancelled the pending supplier order', unlinked.cancelledOrderIds.includes(preUnlinkPending.supplierOrderId), unlinked.cancelledOrderIds)
  check('unlink cancelled the confirmed supplier order', unlinked.cancelledOrderIds.includes(preUnlinkConfirmed.supplierOrderId), unlinked.cancelledOrderIds)
  check('unlink releases the newly confirmed reservation before revocation',
    reservedAfterUnlink <= preUnlinkReservedAfter - 3,
    { before: preUnlinkReservedBefore, beforeUnlink: preUnlinkReservedAfter, afterUnlink: reservedAfterUnlink, releasedInventoryIds: unlinked.releasedInventoryIds })
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
  check('unlink tore down partner project access',
    unlinked.revokedProjectAccessIds.includes(`${sharedProject.id}_org-b`),
    unlinked.revokedProjectAccessIds)
  check('partner no longer sees the shared project after unlink',
    !(await listPartnerProjects('org-b')).sharedWithMe.some((p) => p.projectId === sharedProject.id))
  let postUnlinkRead = false
  try { await loadSharedRecord({ shareId: share2.id, viewerOrgId: 'org-b' }) } catch { postUnlinkRead = true }
  check('shared record unreadable after unlink', postUnlinkRead)
  check('the underlying project still exists', Boolean((await doc('projects', projRef.id)).name))

  check('unrelated link (org-c) untouched',
    (await doc('businessRelationships', r2.sourceRelationshipId)).status === 'active')
  check('unrelated company (Gamma) still linked',
    (await doc('companies', aCompanyGamma)).linkedOrgId === 'org-c')

  // =======================================================================
  console.log('\n[5b] Trading/settlement mutations are refused after unlink')
  // =======================================================================
  // The two pre-unlink orders from [4p] must now be inert: the supplier can
  // no longer confirm, fulfil, cancel, or settle anything on the dead link.
  let confirmAfterUnlink = false
  try {
    await decidePartnerOrder({ supplierOrgId: 'org-a', orderId: preUnlinkPending.supplierOrderId, decision: 'confirm', actor })
  } catch { confirmAfterUnlink = true }
  check('cannot confirm a pending order after unlink', confirmAfterUnlink)

  let shipAfterUnlink = false
  try {
    await fulfilPartnerOrder({ supplierOrgId: 'org-a', orderId: preUnlinkConfirmed.supplierOrderId, action: 'ship', actor })
  } catch { shipAfterUnlink = true }
  check('cannot ship a confirmed order after unlink', shipAfterUnlink)

  let deliverAfterUnlink = false
  try {
    await fulfilPartnerOrder({ supplierOrgId: 'org-a', orderId: preUnlinkConfirmed.supplierOrderId, action: 'deliver', actor })
  } catch { deliverAfterUnlink = true }
  check('cannot deliver after unlink', deliverAfterUnlink)

  let cancelAfterUnlink = false
  try {
    await cancelPartnerOrder({ orgId: 'org-a', orderId: preUnlinkPending.supplierOrderId, actor })
  } catch { cancelAfterUnlink = true }
  check('cannot cancel after unlink', cancelAfterUnlink)

  let payAfterUnlink = false
  try {
    await recordPartnerPayment({ payerOrgId: 'org-b', invoiceId: preUnlinkDecision.invoiceId!, reference: 'LATE', amount: Number((await doc('invoices', preUnlinkDecision.invoiceId!)).total), idempotencyKey: 'unlink-payment', actor: partnerActor })
  } catch { payAfterUnlink = true }
  check('cannot record a payment after unlink', payAfterUnlink)

  let verifyAfterUnlink = false
  try {
    await decidePartnerPayment({ issuerOrgId: 'org-a', invoiceId: preUnlinkDecision.invoiceId!, decision: 'confirm', idempotencyKey: 'unlink-confirm', actor })
  } catch { verifyAfterUnlink = true }
  check('cannot verify a payment after unlink', verifyAfterUnlink)

  let listCatalogueAfterUnlink = false
  try {
    await browsePartnerCatalog({ buyerOrgId: 'org-b', relationshipId: r1.targetRelationshipId })
  } catch { listCatalogueAfterUnlink = true }
  check('buyer cannot browse the catalogue after unlink', listCatalogueAfterUnlink)

  // The refusal must be atomic: unlink's known reservation release is complete,
  // and the refused calls must not move stock or draft another invoice.
  check('no stock movement happened during the refused mutations',
    (await reservedTotalFor(gadgetRef.id)) === reservedAfterUnlink,
    { afterUnlink: reservedAfterUnlink, afterRefusals: await reservedTotalFor(gadgetRef.id) })
  const preUnlinkInvoices = await adminDb.collection('invoices')
    .where('tradeOrderId', '==', preUnlinkConfirmed.tradeOrderId).get()
  check('no duplicate invoice drafted after unlink refusals', preUnlinkInvoices.docs.length === 1, preUnlinkInvoices.docs.length)
  check('the cancelled confirmed order has no fulfilment progress',
    (await doc('orders', preUnlinkConfirmed.supplierOrderId)).fulfillmentStatus === 'not_started')
  check('the pending order was cancelled by unlink and cannot be reconfirmed',
    (await doc('orders', preUnlinkPending.supplierOrderId)).partnerOrderStatus === 'cancelled')

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
