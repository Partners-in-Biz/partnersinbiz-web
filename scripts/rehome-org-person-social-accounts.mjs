#!/usr/bin/env node
/**
 * Move org-scoped person-profile social accounts into Personal marketing.
 *
 * Usage:
 *   node scripts/rehome-org-person-social-accounts.mjs --orgId=pib-platform-owner
 *   node scripts/rehome-org-person-social-accounts.mjs --orgId=pib-platform-owner --apply
 */
import { config as loadDotenv } from 'dotenv'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import process from 'node:process'

loadDotenv({ path: '.env.local', quiet: true })

const KNOWN_ORG_PERSON_TWIN_IDS = new Set([
  'I478D32VOu4rm7a2utoS',
  'z6jekgWOpRJs229kbd4I',
  'Kod7W9yQ6h6QStYtKcKc',
  'DoSNwHvOI6Q3CmBREAPe',
  'Wf2bCTtxplgaM7SkRzG8',
])
const PERSON_PROFILE_PLATFORMS = new Set(['linkedin', 'twitter', 'x', 'facebook'])

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
const orgIdArg = process.argv.find((arg) => arg.startsWith('--orgId='))
const orgId = orgIdArg?.slice('--orgId='.length).trim() || 'pib-platform-owner'

function env(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value.replace(/^"|"$/g, '')
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isOrgPersonProfileTwin(id, data) {
  if (data.accountScope === 'personal') return false
  if (KNOWN_ORG_PERSON_TWIN_IDS.has(id)) return true
  const platform = clean(data.platform).toLowerCase()
  if (!PERSON_PROFILE_PLATFORMS.has(platform)) return false
  const kind = clean(data.accountType || data.subAccountType).toLowerCase()
  return kind === 'personal'
}

function initDb() {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: env('FIREBASE_ADMIN_PROJECT_ID'),
        clientEmail: env('FIREBASE_ADMIN_CLIENT_EMAIL'),
        privateKey: env('FIREBASE_ADMIN_PRIVATE_KEY').replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    })
  }
  const db = getFirestore()
  db.settings({ ignoreUndefinedProperties: true })
  return db
}

async function main() {
  const db = initDb()
  const snap = await db.collection('social_accounts').where('orgId', '==', orgId).get()
  const personalOwners = new Map()
  for (const doc of snap.docs) {
    const data = doc.data()
    if (data.accountScope !== 'personal') continue
    const ownerUid = clean(data.ownerUid)
    const platformAccountId = clean(data.platformAccountId)
    if (!ownerUid || !platformAccountId) continue
    personalOwners.set(`${clean(data.platform).toLowerCase()}:${platformAccountId}`, ownerUid)
  }

  const rows = snap.docs.flatMap((doc) => {
    const data = doc.data()
    if (!isOrgPersonProfileTwin(doc.id, data)) return []
    const connectedBy = clean(data.connectedBy)
    const ownerUid = (connectedBy && connectedBy !== 'oauth')
      ? connectedBy
      : (personalOwners.get(`${clean(data.platform).toLowerCase()}:${clean(data.platformAccountId)}`) || '')
    return [{
      id: doc.id,
      ref: doc.ref,
      platform: data.platform ?? null,
      displayName: data.displayName ?? data.username ?? null,
      accountType: data.accountType ?? data.subAccountType ?? null,
      connectedBy: connectedBy || null,
      ownerUid: ownerUid || null,
      isDefault: data.isDefault === true,
    }]
  })

  const ownerByName = new Map()
  for (const row of rows) {
    const name = clean(row.displayName).toLowerCase()
    if (row.ownerUid && name) ownerByName.set(`${clean(row.platform).toLowerCase()}:${name}`, row.ownerUid)
  }
  for (const row of rows) {
    if (row.ownerUid) continue
    const name = clean(row.displayName).toLowerCase()
    row.ownerUid = ownerByName.get(`${clean(row.platform).toLowerCase()}:${name}`) || null
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    orgId,
    total: rows.length,
    missingOwnerUid: rows.filter((row) => !row.ownerUid).length,
    sample: rows.slice(0, 30).map(({ id, platform, displayName, accountType, ownerUid, isDefault }) => ({
      id, platform, displayName, accountType, ownerUid, isDefault,
    })),
  }, null, 2))

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to move these rows into Personal marketing.')
    return
  }

  let batch = db.batch()
  let pending = 0
  let committed = 0
  for (const row of rows) {
    batch.set(row.ref, {
      accountScope: 'personal',
      ownerUid: row.ownerUid || null,
      isDefault: false,
      marketingOwner: 'personal',
      rehomedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    pending += 1
    if (pending === 450) {
      await batch.commit()
      committed += pending
      batch = db.batch()
      pending = 0
    }
  }
  if (pending > 0) {
    await batch.commit()
    committed += pending
  }
  console.log(`Rehomed ${committed} social_accounts docs to accountScope=personal.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
