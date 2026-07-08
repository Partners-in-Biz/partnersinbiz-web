#!/usr/bin/env node
import { config as loadDotenv } from 'dotenv'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import process from 'node:process'

loadDotenv({ path: '.env.local', quiet: true })

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
const orgIdArg = process.argv.find((arg) => arg.startsWith('--orgId='))
const orgId = orgIdArg?.slice('--orgId='.length).trim()

function env(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value.replace(/^"|"$/g, '')
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

async function collectMissingScopeDocs(db) {
  let query = db.collection('social_accounts')
  if (orgId) query = query.where('orgId', '==', orgId)

  const snap = await query.get()
  return snap.docs
    .filter((doc) => doc.data().accountScope === undefined)
    .map((doc) => ({
      ref: doc.ref,
      path: doc.ref.path,
      orgId: doc.get('orgId') ?? null,
      platform: doc.get('platform') ?? null,
      displayName: doc.get('displayName') ?? doc.get('username') ?? null,
    }))
}

async function commitInBatches(db, rows) {
  let batch = db.batch()
  let pending = 0
  let committed = 0

  for (const row of rows) {
    batch.set(row.ref, {
      accountScope: 'org',
      ownerUid: null,
      accountScopeBackfilledAt: FieldValue.serverTimestamp(),
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

  return committed
}

async function main() {
  const db = initDb()
  const rows = await collectMissingScopeDocs(db)
  const byOrg = rows.reduce((acc, row) => {
    const key = row.orgId ?? 'missing-org'
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    orgId: orgId ?? 'ALL_ORGS',
    totalMissingAccountScope: rows.length,
    byOrg,
    sample: rows.slice(0, 20).map(({ path, orgId, platform, displayName }) => ({ path, orgId, platform, displayName })),
  }, null, 2))

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to write accountScope=org and ownerUid=null to missing-scope social_accounts docs.')
    return
  }

  const committed = await commitInBatches(db, rows)
  console.log(`Updated ${committed} social_accounts docs with accountScope=org.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
