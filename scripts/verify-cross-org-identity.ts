/**
 * Emulator-backed verification for canonical many-to-many identity links
 * (task ouJ9IpOFkBPKuaxseu7S, project JZ7TSJjnGYjv87h6OAst).
 *
 * EMULATOR-ONLY — refuses to run unless FIRESTORE_EMULATOR_HOST is set, so it
 * can never touch production data.
 *
 * Run:
 *   firebase emulators:exec --only firestore --project partner-links-verify \
 *     "npx tsx scripts/verify-cross-org-identity.ts"
 *
 * Exercises the canonical identity service (lib/cross-org/identity.ts) plus
 * the acceptance-on-behalf fix in acceptPartnerInvite, and asserts the
 * resulting Firestore state on BOTH sides: many-to-many join rows, primary
 * convenience pointer retention, approver-vs-recipient separation, safe
 * unlink/relink and idempotent backfill.
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
  const { createPartnerInvite, acceptPartnerInvite, unlinkPartnership, getPartnerInviteById } =
    await import('@/lib/partner-links/store')
  const {
    ensureIdentityLink,
    listIdentityLinks,
    planIdentityBackfill,
    verifyIdentityLink,
    revokeIdentityLink,
  } = await import('@/lib/cross-org/identity')
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
  console.log('\n[1] Recipient accepts — identity matched, contact_user link verified')
  // =======================================================================
  await seedOrg('org-a', 'Alpha Consulting', 'https://alpha.example')
  await seedOrg('org-b', 'Beta Manufacturing', 'https://beta.example')
  const aCompanyBeta = await seedCompany('org-a', 'Beta Manufacturing')
  const aContactBea = await seedContact('org-a', 'Bea Owner', 'owner@beta.example')

  const { invite: inv1 } = await createPartnerInvite({
    kind: 'contact',
    sourceOrgId: 'org-a',
    sourceCompanyId: aCompanyBeta,
    sourceContactId: aContactBea,
    recipientEmail: 'owner@beta.example',
    recipientName: 'Bea Owner',
    recipientCompanyName: 'Beta Manufacturing',
    actor,
    inviterUserId: 'user:alpha-boss',
    inviterEmail: 'boss@alpha.example',
    inviterName: 'Alpha Boss',
  })

  const r1 = await acceptPartnerInvite({
    invite: inv1,
    targetOrgId: 'org-b',
    targetUserId: 'user:bea',
    approvedByUserId: 'user:bea',
    recipientIdentityMatched: true,
    actor: { uid: 'user:bea', displayName: 'Bea Owner', kind: 'human' },
  })
  check('recipient-linked result reports identity matched', r1.recipientIdentityMatched === true)
  check('approvedByUserId is the recipient', r1.approvedByUserId === 'user:bea')
  check('identity links created for the acceptance', r1.identityLinkIds.length >= 4, r1.identityLinkIds.length)

  const sourceLinks = await listIdentityLinks({ companyId: aCompanyBeta })
  const companyOrgLinks = sourceLinks.filter((l) => l.linkType === 'company_org')
  check('source company has a verified company_org link to org-b',
    companyOrgLinks.some((l) => l.targetRef.id === 'org-b' && l.status === 'verified'),
    companyOrgLinks.map((l) => ({ t: l.targetRef.id, s: l.status })))
  check('source company convenience pointer = org-b',
    (await doc('companies', aCompanyBeta)).linkedOrgId === 'org-b')

  const beaLinks = await listIdentityLinks({ contactId: aContactBea })
  check('recipient contact has verified contact_user link to user:bea',
    beaLinks.some((l) => l.linkType === 'contact_user' && l.targetRef.id === 'user:bea' && l.status === 'verified'),
    beaLinks.filter((l) => l.linkType === 'contact_user').map((l) => ({ t: l.targetRef.id, s: l.status })))
  const beaAfter = await doc('contacts', aContactBea)
  check('recipient contact convenience linkedUserId = user:bea', beaAfter.linkedUserId === 'user:bea', beaAfter.linkedUserId)
  check('recipient contact convenience linkedOrgId = org-b', beaAfter.linkedOrgId === 'org-b', beaAfter.linkedOrgId)

  // =======================================================================
  console.log('\n[2] Owner/admin accepts on behalf — approver recorded SEPARATELY, never the linked user')
  // =======================================================================
  await seedOrg('org-c', 'Gamma Logistics', 'https://gamma.example')
  const aCompanyGamma = await seedCompany('org-a', 'Gamma Logistics')
  const aContactGary = await seedContact('org-a', 'Gary Driver', 'gary@gamma.example')

  const { invite: inv2 } = await createPartnerInvite({
    kind: 'contact',
    sourceOrgId: 'org-a',
    sourceCompanyId: aCompanyGamma,
    sourceContactId: aContactGary,
    recipientEmail: 'gary@gamma.example',
    recipientName: 'Gary Driver',
    recipientCompanyName: 'Gamma Logistics',
    actor,
    inviterUserId: 'user:alpha-boss',
    inviterEmail: 'boss@alpha.example',
    inviterName: 'Alpha Boss',
  })

  // An org owner/admin of Gamma accepts for Gary (forwarded invite scenario).
  const r2 = await acceptPartnerInvite({
    invite: inv2,
    targetOrgId: 'org-c',
    // Deliberately hostile/mistaken caller input: recipientIdentityMatched=false
    // MUST suppress this supplied approver uid from all recipient linkage.
    targetUserId: 'user:gamma-owner',
    approvedByUserId: 'user:gamma-owner',
    recipientIdentityMatched: false,
    actor: { uid: 'user:gamma-owner', displayName: 'Gamma Owner', kind: 'human' },
  })
  check('on-behalf result reports recipient NOT linked', r2.recipientIdentityMatched === false)
  check('on-behalf result records the approver separately', r2.approvedByUserId === 'user:gamma-owner')
  check('on-behalf result has no recipient targetUserId', r2.targetUserId === undefined)

  const garyAfter = await doc('contacts', aContactGary)
  check('approver NEVER becomes the invited contact linkedUserId',
    !garyAfter.linkedUserId || garyAfter.linkedUserId !== 'user:gamma-owner',
    garyAfter.linkedUserId)
  check('contact still carries the org-level pointer', garyAfter.linkedOrgId === 'org-c', garyAfter.linkedOrgId)

  const garyLinks = await listIdentityLinks({ contactId: aContactGary })
  const garyUserTargets = garyLinks.filter((l) => l.targetRef.kind === 'user').map((l) => l.targetRef.id)
  check('no contact_user link points at the approver', !garyUserTargets.includes('user:gamma-owner'), garyUserTargets)
  check('org-level identity links are verified by the approver',
    garyLinks.filter((l) => l.linkType === 'contact_org').every((l) => l.status === 'verified' && l.verifiedByRef?.uid === 'user:gamma-owner'))

  const inv2After = await getPartnerInviteById(inv2.id)
  check('invite acceptedByUserId = approver (not recipient)', inv2After?.acceptedByUserId === 'user:gamma-owner', inv2After?.acceptedByUserId)
  check('invite recipientUserId absent on on-behalf accept', inv2After?.recipientUserId === undefined, inv2After?.recipientUserId)
  check('invite recipientIdentityMatched false', inv2After?.recipientIdentityMatched === false)
  check('invite approvedByRef recorded', Boolean(inv2After?.approvedByRef?.uid), inv2After?.approvedByRef)

  // =======================================================================
  console.log('\n[3] Many-to-many — holding company links to TWO subsidiary orgs')
  // =======================================================================
  await seedOrg('org-d', 'Delta Retail', 'https://delta.example')
  await seedOrg('org-e', 'Echo Media', 'https://echo.example')
  const holdCo = await seedCompany('org-a', 'Delta Retail')
  const { invite: inv3a } = await createPartnerInvite({
    kind: 'company', sourceOrgId: 'org-a', sourceCompanyId: holdCo,
    recipientEmail: 'owner@delta.example', recipientName: 'Delta Owner',
    recipientCompanyName: 'Delta Retail', actor,
  })
  await acceptPartnerInvite({
    invite: inv3a, targetOrgId: 'org-d', targetUserId: 'user:delta-owner',
    approvedByUserId: 'user:delta-owner', recipientIdentityMatched: true, actor,
  })

  const { invite: inv3b } = await createPartnerInvite({
    kind: 'company', sourceOrgId: 'org-a', sourceCompanyId: holdCo,
    recipientEmail: 'owner@echo.example', recipientName: 'Echo Owner',
    recipientCompanyName: 'Echo Media', actor,
  })
  await acceptPartnerInvite({
    invite: inv3b, targetOrgId: 'org-e', targetUserId: 'user:echo-owner',
    approvedByUserId: 'user:echo-owner', recipientIdentityMatched: true, actor,
  })

  const holdLinks = await listIdentityLinks({ companyId: holdCo })
  const holdOrgTargets = holdLinks.filter((l) => l.linkType === 'company_org' && l.status === 'verified').map((l) => l.targetRef.id).sort()
  check('holding company links to BOTH subsidiary orgs', JSON.stringify(holdOrgTargets) === JSON.stringify(['org-d', 'org-e']), holdOrgTargets)
  check('holding company primary pointer = earliest verified (org-d)',
    (await doc('companies', holdCo)).linkedOrgId === 'org-d',
    (await doc('companies', holdCo)).linkedOrgId)

  // =======================================================================
  console.log('\n[4] Multi-client contact — one person at TWO client orgs')
  // =======================================================================
  const sharedContact = await seedContact('org-a', 'Sam Shared', 'sam@shared.example')
  const { invite: inv4a } = await createPartnerInvite({
    kind: 'contact', sourceOrgId: 'org-a', sourceCompanyId: aCompanyBeta,
    sourceContactId: sharedContact, recipientEmail: 'sam@shared.example',
    recipientName: 'Sam Shared', recipientCompanyName: 'Beta Manufacturing', actor,
  })
  await acceptPartnerInvite({
    invite: inv4a, targetOrgId: 'org-b', targetUserId: 'user:sam',
    approvedByUserId: 'user:sam', recipientIdentityMatched: true, actor,
  })
  const { invite: inv4b } = await createPartnerInvite({
    kind: 'contact', sourceOrgId: 'org-a', sourceCompanyId: aCompanyGamma,
    sourceContactId: sharedContact, recipientEmail: 'sam@shared.example',
    recipientName: 'Sam Shared', recipientCompanyName: 'Gamma Logistics', actor,
  })
  await acceptPartnerInvite({
    invite: inv4b, targetOrgId: 'org-c', targetUserId: 'user:sam',
    approvedByUserId: 'user:sam', recipientIdentityMatched: true, actor,
  })

  const samLinks = await listIdentityLinks({ contactId: sharedContact })
  check('multi-client contact has BOTH org links',
    samLinks.filter((l) => l.linkType === 'contact_org' && l.status === 'verified').map((l) => l.targetRef.id).sort().join(',') === 'org-b,org-c')
  const samUserLinks = samLinks.filter((l) => l.linkType === 'contact_user' && l.status === 'verified')
  // A contact_user link is keyed by (contact, user): the SAME user at two
  // client orgs is ONE canonical user link — the multi-client membership is
  // carried by the two contact_org links above.
  check('multi-client contact user link dedupes to one verified row for user:sam',
    samUserLinks.length === 1 && samUserLinks[0].targetRef.id === 'user:sam',
    samUserLinks.map((l) => l.targetRef.id))
  const samAfter = await doc('contacts', sharedContact)
  check('multi-client contact primary org pointer = earliest verified (org-b)', samAfter.linkedOrgId === 'org-b', samAfter.linkedOrgId)
  check('multi-client contact primary user pointer preserved', samAfter.linkedUserId === 'user:sam', samAfter.linkedUserId)

  // =======================================================================
  console.log('\n[5] Safe unlink — identity links revoked, remaining many-to-many link becomes primary')
  // =======================================================================
  const holdRel = await adminDb.collection('businessRelationships')
    .where('sourceOrgId', '==', 'org-a')
    .where('sourceCompanyId', '==', holdCo)
    .where('targetOrgId', '==', 'org-d')
    .limit(1)
    .get()
  const unlinked = await unlinkPartnership({
    relationshipId: holdRel.docs[0].id,
    actingOrgId: 'org-a',
    actor,
  })
  check('unlink revoked canonical identity links', unlinked.revokedIdentityLinkIds.length > 0, unlinked.revokedIdentityLinkIds.length)

  const holdAfterUnlink = await listIdentityLinks({ companyId: holdCo })
  const holdRevoked = holdAfterUnlink.filter((l) => l.linkType === 'company_org' && l.status === 'revoked')
  check('org-d identity links revoked after unlink',
    holdRevoked.some((l) => l.targetRef.id === 'org-d'), holdRevoked.map((l) => l.targetRef.id))
  check('org-e identity link STILL active (many-to-many survives)',
    holdAfterUnlink.some((l) => l.linkType === 'company_org' && l.targetRef.id === 'org-e' && l.status === 'verified'))
  check('holding company pointer resyncs to remaining org (org-e)',
    (await doc('companies', holdCo)).linkedOrgId === 'org-e',
    (await doc('companies', holdCo)).linkedOrgId)

  // =======================================================================
  console.log('\n[6] Safe relink — fresh row created, revoked history retained, pointer restored')
  // =======================================================================
  const { invite: inv6 } = await createPartnerInvite({
    kind: 'company', sourceOrgId: 'org-a', sourceCompanyId: holdCo,
    recipientEmail: 'owner@delta.example', recipientName: 'Delta Owner',
    recipientCompanyName: 'Delta Retail', actor,
  })
  const r6 = await acceptPartnerInvite({
    invite: inv6, targetOrgId: 'org-d', targetUserId: 'user:delta-owner',
    approvedByUserId: 'user:delta-owner', recipientIdentityMatched: true, actor,
  })
  const holdAfterRelink = await listIdentityLinks({ companyId: holdCo })
  const orgDLinks = holdAfterRelink.filter((l) => l.linkType === 'company_org' && l.targetRef.id === 'org-d')
  check('relink created a FRESH active org-d link', orgDLinks.some((l) => l.status === 'verified'), orgDLinks.map((l) => l.status))
  check('revoked history retained (never resurrected)', orgDLinks.some((l) => l.status === 'revoked'))
  check('relink result carries identity link ids', r6.identityLinkIds.length > 0, r6.identityLinkIds.length)

  // =======================================================================
  console.log('\n[7] Backfill — legacy pointers seed canonical rows idempotently')
  // =======================================================================
  const legacyCompany = await seedCompany('org-a', 'Legacy Co', { linkedOrgId: 'org-legacy' })
  const legacyContact = await seedContact('org-a', 'Legacy Person', 'legacy@example.com', {
    linkedOrgId: 'org-legacy',
    linkedUserId: 'user-legacy',
  })

  async function backfillOnce(): Promise<number> {
    let created = 0
    const companyLinks = await listIdentityLinks({ companyId: legacyCompany })
    const contactLinks = await listIdentityLinks({ contactId: legacyContact })
    const plan = planIdentityBackfill({
      companyId: legacyCompany,
      contactId: legacyContact,
      pointers: { linkedOrgId: 'org-legacy', linkedUserId: 'user-legacy' },
      existing: [...companyLinks, ...contactLinks],
    })
    for (const candidate of plan) {
      const result = await ensureIdentityLink({
        linkType: candidate.linkType,
        sourceRef: candidate.sourceRef,
        targetRef: candidate.targetRef,
        status: candidate.status,
        provenance: candidate.provenance,
        actor,
      })
      if (result.created) created += 1
    }
    return created
  }

  const firstBackfill = await backfillOnce()
  check('backfill created the missing canonical rows', firstBackfill === 3, firstBackfill)
  const secondBackfill = await backfillOnce()
  check('backfill is idempotent (no duplicates on re-run)', secondBackfill === 0, secondBackfill)
  const backfilledCompanyLinks = await listIdentityLinks({ companyId: legacyCompany })
  check('backfilled company link starts unverified',
    backfilledCompanyLinks.every((l) => l.status === 'unverified'),
    backfilledCompanyLinks.map((l) => l.status))
  check('backfilled rows never fabricate verification',
    backfilledCompanyLinks.every((l) => !l.verifiedByRef))

  // =======================================================================
  console.log('\n[8] Direct service semantics — verify + revoke + list isolation')
  // =======================================================================
  const unverified = await ensureIdentityLink({
    linkType: 'company_org',
    sourceRef: { kind: 'company', id: legacyCompany },
    targetRef: { kind: 'org', id: 'org-direct' },
    status: 'unverified',
    actor,
  })
  check('ensure is idempotent', (await ensureIdentityLink({
    linkType: 'company_org',
    sourceRef: { kind: 'company', id: legacyCompany },
    targetRef: { kind: 'org', id: 'org-direct' },
    status: 'unverified',
    actor,
  })).created === false)

  const verified = await verifyIdentityLink({ id: unverified.link.id, actor })
  check('verify flips to verified with approver recorded',
    verified?.status === 'verified' && verified.verifiedByRef?.uid === 'user:tester')

  const revoked = await revokeIdentityLink({ id: unverified.link.id, actor, reason: 'test' })
  check('revoke is permanent', revoked?.status === 'revoked')
  const revokedList = await listIdentityLinks({ companyId: legacyCompany, status: 'revoked' })
  check('revoked row visible via status filter', revokedList.some((l) => l.id === unverified.link.id))

  console.log(`\nIDENTITY VERIFICATION: ${checks} checks, ${failures} failures`)
  if (failures > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
