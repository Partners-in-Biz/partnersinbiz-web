#!/usr/bin/env node
/**
 * Remap ownership/assignment from an old Firebase UID to a new UID after a
 * hard Auth delete + recreate (e.g. platform-users DELETE then re-add).
 *
 * Dry-run by default.
 *
 * Usage:
 *   node scripts/remap-user-uid.cjs --old-uid OLD --new-uid NEW
 *   node scripts/remap-user-uid.cjs --old-uid OLD --new-uid NEW --commit
 *   node scripts/remap-user-uid.cjs --discover stean@example.com
 *   node scripts/remap-user-uid.cjs --discover-name Stean
 */
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs')
const { resolve } = require('path')
const admin = require('firebase-admin')

const STRING_FIELDS = [
  'assignedTo', 'ownerUid', 'accountManagerUid', 'createdBy', 'updatedBy',
  'linkedUserId', 'userId', 'uid', 'ownerUserId', 'createdByUserId',
  'recipientUserId', 'targetUserId', 'paymentProofConfirmedBy', 'startedBy',
]

const ARRAY_FIELDS = [
  'allowedUserIds', 'assignedUserIds', 'delegatedActorUids', 'participantUids',
]

const REF_FIELDS = [
  'assignedToRef', 'ownerRef', 'accountManagerRef', 'createdByRef', 'updatedByRef',
]

const TARGETED_QUERIES = [
  ['contacts', 'assignedTo'],
  ['contacts', 'createdBy'],
  ['contacts', 'updatedBy'],
  ['contacts', 'linkedUserId'],
  ['companies', 'ownerUid'],
  ['companies', 'accountManagerUid'],
  ['companies', 'createdBy'],
  ['companies', 'updatedBy'],
  ['deals', 'ownerUid'],
  ['deals', 'createdBy'],
  ['deals', 'updatedBy'],
  ['activities', 'createdBy'],
  ['activities', 'updatedBy'],
  ['invoices', 'createdBy'],
  ['invoices', 'recipientUserId'],
  ['invoices', 'targetUserId'],
  ['quotes', 'createdBy'],
  ['quotes', 'updatedBy'],
  ['projects', 'ownerUid'],
  ['projects', 'createdBy'],
  ['tasks', 'createdBy'],
  ['tasks', 'assignedTo'],
  ['notifications', 'userId'],
  ['conversations', 'startedBy'],
  ['social_accounts', 'ownerUid'],
  ['mailbox_accounts', 'uid'],
]

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const k = trimmed.slice(0, eq).trim()
    const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

function parseFlags(argv) {
  const flags = { dryRun: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--commit') flags.dryRun = false
    else if (a === '--dry-run') flags.dryRun = true
    else if (a === '--old-uid') flags.oldUid = argv[++i]
    else if (a === '--new-uid') flags.newUid = argv[++i]
    else if (a === '--discover') flags.discoverEmail = argv[++i]
    else if (a === '--discover-name') flags.discoverName = argv[++i]
    else if (a === '--org-id') flags.orgId = argv[++i]
  }
  return flags
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function initAdmin() {
  if (admin.apps.length === 0) {
    const keyPath = resolve(process.cwd(), 'service-account.json')
    const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim()
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim()
    const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n').trim()
    if (existsSync(keyPath)) {
      admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) })
    } else if (projectId && clientEmail && privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      })
    } else {
      admin.initializeApp({ credential: admin.credential.applicationDefault() })
    }
  }
  return admin
}

function patchDocument(data, oldUid, newUid) {
  const patch = {}
  let changed = false

  for (const field of STRING_FIELDS) {
    if (cleanString(data[field]) === oldUid) {
      patch[field] = newUid
      changed = true
    }
  }

  for (const field of ARRAY_FIELDS) {
    const value = data[field]
    if (!Array.isArray(value)) continue
    if (!value.some((item) => cleanString(item) === oldUid)) continue
    patch[field] = Array.from(new Set(value.map((item) => (cleanString(item) === oldUid ? newUid : item))))
    changed = true
  }

  for (const field of REF_FIELDS) {
    const ref = data[field]
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) continue
    if (cleanString(ref.uid) !== oldUid) continue
    patch[field] = { ...ref, uid: newUid }
    changed = true
  }

  if (Array.isArray(data.participants)) {
    let touched = false
    const next = data.participants.map((row) => {
      if (!row || typeof row !== 'object') return row
      if (cleanString(row.uid) !== oldUid) return row
      touched = true
      return { ...row, uid: newUid }
    })
    if (touched) {
      patch.participants = next
      changed = true
    }
  }

  return changed ? patch : null
}

async function discover(db, auth, flags) {
  const email = cleanString(flags.discoverEmail).toLowerCase()
  const nameNeedle = cleanString(flags.discoverName).toLowerCase()
  console.log('\n=== Discover users / memberships ===\n')

  if (email) {
    try {
      const user = await auth.getUserByEmail(email)
      console.log(`Auth by email ${email}: uid=${user.uid} displayName=${user.displayName || ''}`)
    } catch (err) {
      console.log(`Auth by email ${email}: ${err.code || err.message || err}`)
    }
  }

  const usersSnap = await db.collection('users').get()
  for (const doc of usersSnap.docs) {
    const data = doc.data()
    const rowEmail = cleanString(data.email).toLowerCase()
    const displayName = cleanString(data.displayName || data.name)
    const matchEmail = email && rowEmail === email
    const matchName = nameNeedle && displayName.toLowerCase().includes(nameNeedle)
    if (!matchEmail && !matchName) continue
    console.log(`users/${doc.id}`, JSON.stringify({
      email: data.email,
      displayName,
      role: data.role,
      orgId: data.orgId,
      orgIds: data.orgIds,
      deleted: data.deleted || false,
    }))
  }

  const membersSnap = await db.collection('orgMembers').get()
  for (const doc of membersSnap.docs) {
    const data = doc.data()
    const displayName = [cleanString(data.firstName), cleanString(data.lastName)].filter(Boolean).join(' ')
      || cleanString(data.displayName)
      || cleanString(data.name)
    const rowEmail = cleanString(data.email).toLowerCase()
    const uid = cleanString(data.uid) || doc.id.split('_').slice(1).join('_')
    const matchEmail = email && rowEmail === email
    const matchName = nameNeedle && (
      displayName.toLowerCase().includes(nameNeedle)
      || cleanString(data.firstName).toLowerCase().includes(nameNeedle)
    )
    if (!matchEmail && !matchName) continue
    console.log(`orgMembers/${doc.id}`, JSON.stringify({
      uid,
      orgId: data.orgId,
      role: data.role,
      email: data.email,
      displayName,
      status: data.status,
    }))
  }

  const knownOld = '4m5JmAQ8mvWjJxnqibOFGVPfIVR2'
  for (const uid of [knownOld]) {
    const [assigned, created] = await Promise.all([
      db.collection('contacts').where('assignedTo', '==', uid).limit(50).get(),
      db.collection('contacts').where('createdBy', '==', uid).limit(50).get(),
    ])
    console.log(`CRM contact hits for OLD uid ${uid}: assigned=${assigned.size} created=${created.size}`)
  }
}

async function remapMemberships(db, oldUid, newUid, dryRun) {
  const report = []
  const memberDocs = await db.collection('orgMembers').get()
  for (const doc of memberDocs.docs) {
    const data = doc.data()
    const uid = cleanString(data.uid)
    const embedsOld = doc.id.endsWith(`_${oldUid}`) || uid === oldUid
    if (!embedsOld) continue
    const orgId = cleanString(data.orgId) || doc.id.slice(0, Math.max(0, doc.id.length - oldUid.length - 1))
    const newId = `${orgId}_${newUid}`
    const existingNew = await db.collection('orgMembers').doc(newId).get()
    report.push({
      type: 'orgMember',
      oldId: doc.id,
      newId,
      orgId,
      action: existingNew.exists ? 'merge-into-existing-new' : 'copy-to-new-delete-old',
    })
    if (!dryRun) {
      const payload = { ...data, uid: newUid, userId: newUid, updatedAt: new Date() }
      if (existingNew.exists) {
        await db.collection('orgMembers').doc(newId).set({
          ...payload,
          role: existingNew.data()?.role || payload.role,
          accessPolicy: existingNew.data()?.accessPolicy || payload.accessPolicy,
          accessScope: existingNew.data()?.accessScope || payload.accessScope,
        }, { merge: true })
      } else {
        await db.collection('orgMembers').doc(newId).set(payload)
      }
      await doc.ref.delete()
    }
  }

  const orgs = await db.collection('organizations').get()
  for (const org of orgs.docs) {
    const data = org.data()
    const members = Array.isArray(data.members) ? data.members : null
    if (!members) continue
    let touched = false
    const next = members.map((row) => {
      if (!row || typeof row !== 'object') return row
      if (cleanString(row.userId) !== oldUid) return row
      touched = true
      return { ...row, userId: newUid }
    })
    if (!touched) continue
    report.push({ type: 'organization.members', orgId: org.id, action: 'rewrite-userId' })
    if (!dryRun) await org.ref.update({ members: next, updatedAt: new Date() })
  }
  return report
}

async function remapCollections(db, oldUid, newUid, dryRun, orgId) {
  const report = []
  const seen = new Set()

  for (const [collection, field] of TARGETED_QUERIES) {
    let snap
    try {
      snap = await db.collection(collection).where(field, '==', oldUid).get()
    } catch (err) {
      console.warn(`Skip query ${collection}.${field}:`, err.message)
      continue
    }
    for (const doc of snap.docs) {
      const key = `${collection}/${doc.id}`
      if (seen.has(key)) continue
      const data = doc.data()
      if (orgId && cleanString(data.orgId) && cleanString(data.orgId) !== orgId) continue
      const patch = patchDocument(data, oldUid, newUid)
      if (!patch) continue
      seen.add(key)
      report.push({ type: 'doc', collection, id: doc.id, fields: Object.keys(patch) })
      if (!dryRun) await doc.ref.update({ ...patch, updatedAt: new Date() })
    }
  }

  const byCollection = new Map()
  for (const row of report) {
    byCollection.set(row.collection, (byCollection.get(row.collection) || 0) + 1)
  }
  for (const [collection, count] of byCollection) {
    console.log(`${collection}: ${count} docs to patch`)
  }
  return report
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  loadEnv()
  initAdmin()
  const db = admin.firestore()
  const auth = admin.auth()

  if (flags.discoverEmail || flags.discoverName) {
    await discover(db, auth, flags)
    return
  }

  if (!flags.oldUid || !flags.newUid) {
    console.error('Required: --old-uid and --new-uid (or --discover / --discover-name)')
    process.exit(1)
  }
  if (flags.oldUid === flags.newUid) {
    console.error('old and new uid must differ')
    process.exit(1)
  }

  console.log(`Mode: ${flags.dryRun ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Remap ${flags.oldUid} → ${flags.newUid}`)

  const newUser = await db.collection('users').doc(flags.newUid).get()
  if (!newUser.exists) {
    console.error(`users/${flags.newUid} does not exist — create/login the new account first`)
    process.exit(1)
  }
  console.log('New user:', {
    email: newUser.data().email,
    displayName: newUser.data().displayName,
    role: newUser.data().role,
  })

  const membershipReport = await remapMemberships(db, flags.oldUid, flags.newUid, flags.dryRun)
  const docReport = await remapCollections(db, flags.oldUid, flags.newUid, flags.dryRun, flags.orgId)

  if (!flags.dryRun && cleanString(newUser.data().role) === 'admin') {
    console.log('NOTE: new user is still role=admin. Demote to client if he should be portal-only.')
  }

  const outDir = resolve(process.cwd(), 'tmp')
  mkdirSync(outDir, { recursive: true })
  const outPath = resolve(outDir, `remap-user-uid-${flags.oldUid.slice(0, 8)}-to-${flags.newUid.slice(0, 8)}.json`)
  writeFileSync(outPath, JSON.stringify({
    dryRun: flags.dryRun,
    oldUid: flags.oldUid,
    newUid: flags.newUid,
    membershipReport,
    docCount: docReport.length,
    sampleDocs: docReport.slice(0, 80),
  }, null, 2))

  console.log(`\nMembership ops: ${membershipReport.length}`)
  console.log(`Document patches: ${docReport.length}`)
  console.log(`Report: ${outPath}`)
  if (flags.dryRun) console.log('\nRe-run with --commit to apply.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
