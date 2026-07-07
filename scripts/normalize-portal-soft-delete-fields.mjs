#!/usr/bin/env node
import 'dotenv/config'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import process from 'node:process'

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
const orgIdArg = process.argv.find((arg) => arg.startsWith('--orgId='))
const orgId = orgIdArg?.slice('--orgId='.length).trim()

if (!orgId) {
  console.error('Usage: node scripts/normalize-portal-soft-delete-fields.mjs --orgId=<orgId> [--apply]')
  process.exit(1)
}

function env(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function initDb() {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: env('FIREBASE_ADMIN_PROJECT_ID').replace(/^"|"$/g, ''),
        clientEmail: env('FIREBASE_ADMIN_CLIENT_EMAIL').replace(/^"|"$/g, ''),
        privateKey: env('FIREBASE_ADMIN_PRIVATE_KEY').replace(/^"|"$/g, '').replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    })
  }
  const db = getFirestore()
  db.settings({ ignoreUndefinedProperties: true })
  return db
}

const collectionPlans = [
  { collection: 'contacts', fields: ['orgId'] },
  { collection: 'companies', fields: ['orgId'] },
  { collection: 'projects', fields: ['orgId', 'recipientOrgId', 'targetOrgId', 'clientOrgId'] },
  { collection: 'campaigns', fields: ['orgId'] },
  { collection: 'capture_sources', fields: ['orgId'] },
  { collection: 'client_documents', fields: ['orgId'] },
  { collection: 'social_posts', fields: ['orgId'] },
]

async function collectMissingDeletedDocs(db, plan) {
  const byPath = new Map()
  for (const field of plan.fields) {
    const snap = await db.collection(plan.collection).where(field, '==', orgId).get()
    for (const doc of snap.docs) {
      const data = doc.data()
      if (data.deleted === undefined) {
        byPath.set(doc.ref.path, doc.ref)
      }
    }
  }
  return Array.from(byPath.values())
}

async function commitInBatches(db, refs) {
  let batch = db.batch()
  let count = 0
  let committed = 0
  for (const ref of refs) {
    batch.set(ref, {
      deleted: false,
      softDeleteNormalizedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    count += 1
    if (count === 450) {
      await batch.commit()
      committed += count
      batch = db.batch()
      count = 0
    }
  }
  if (count > 0) {
    await batch.commit()
    committed += count
  }
  return committed
}

async function main() {
  const db = initDb()
  const result = []
  const allRefs = []
  for (const plan of collectionPlans) {
    const refs = await collectMissingDeletedDocs(db, plan)
    result.push({
      collection: plan.collection,
      fields: plan.fields,
      missingDeletedFalse: refs.length,
      samplePaths: refs.slice(0, 10).map((ref) => ref.path),
    })
    allRefs.push(...refs)
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    orgId,
    totalMissingDeletedFalse: allRefs.length,
    collections: result,
  }, null, 2))

  if (apply) {
    const committed = await commitInBatches(db, allRefs)
    console.log(`Updated ${committed} docs with deleted=false`)
  } else {
    console.log('Dry run only. Re-run with --apply to write.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
