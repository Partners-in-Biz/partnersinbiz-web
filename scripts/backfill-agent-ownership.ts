#!/usr/bin/env tsx
/**
 * Backfill: reattribute agent-owned records so the human is the owner and the
 * agent is recorded on *AgentId fields.
 *
 * Contract (matches lib/api/actor.ts):
 *   createdBy / updatedBy  → human (when we can resolve one)
 *   createdByAgentId / updatedByAgentId → agent slug (pip, theo, …)
 *
 * Safe modes:
 *   1) Stamp agent ids only (always safe when createdBy is `agent:X`)
 *   2) Reattribute ownership when a high-confidence human owner is found
 *
 * Usage:
 *   npx tsx scripts/backfill-agent-ownership.ts                  # dry-run
 *   npx tsx scripts/backfill-agent-ownership.ts --commit          # write
 *   npx tsx scripts/backfill-agent-ownership.ts --collection client_documents
 *   npx tsx scripts/backfill-agent-ownership.ts --org-id <orgId>
 *   npx tsx scripts/backfill-agent-ownership.ts --stamp-only      # only *AgentId, never change owner
 *   npx tsx scripts/backfill-agent-ownership.ts --limit 50
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import admin from 'firebase-admin'

const DEFAULT_COLLECTIONS = [
  'client_documents',
  'research_items',
  'contacts',
  'companies',
  'deals',
  'social_posts',
  'projects',
] as const

type TargetCollection = (typeof DEFAULT_COLLECTIONS)[number] | string

interface CliFlags {
  dryRun: boolean
  stampOnly: boolean
  orgId?: string
  collection?: string
  limit: number
  batchSize: number
}

interface Patch {
  createdBy?: string
  createdByType?: 'user' | 'agent'
  createdByAgentId?: string
  updatedBy?: string
  updatedByType?: 'user' | 'agent'
  updatedByAgentId?: string
  ownershipReattributed?: boolean
  ownershipSource?: string
}

interface RowReport {
  collection: string
  id: string
  orgId: string
  title: string
  beforeCreatedBy: string
  beforeUpdatedBy: string
  patch: Patch
  action: 'stamp' | 'reattribute' | 'skip'
  reason: string
}

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const content = readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

function initAdmin() {
  if (admin.apps.length > 0) return admin
  const keyPath = resolve(process.cwd(), 'service-account.json')
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim()
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim()
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n').trim()

  if (existsSync(keyPath)) {
    const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8')) as admin.ServiceAccount
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  } else if (projectId && clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    })
  } else {
    admin.initializeApp({ credential: admin.credential.applicationDefault() })
  }
  return admin
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    dryRun: !argv.includes('--commit'),
    stampOnly: argv.includes('--stamp-only'),
    limit: 0,
    batchSize: 200,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--org-id') flags.orgId = argv[++i]
    else if (arg === '--collection') flags.collection = argv[++i]
    else if (arg === '--limit') flags.limit = Math.max(0, Number(argv[++i]) || 0)
    else if (arg === '--batch-size') flags.batchSize = Math.max(1, Number(argv[++i]) || 200)
  }
  return flags
}

function isAgentUid(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (v === 'ai-agent') return true
  return v.startsWith('agent:') && v.length > 'agent:'.length
}

function agentSlugFromUid(uid: string): string {
  const v = uid.trim()
  if (v === 'ai-agent') return 'pip' // legacy shared AI key
  if (v.startsWith('agent:')) return v.slice('agent:'.length).trim()
  return v
}

function isHumanUid(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && !value.startsWith('agent:')
    && !value.startsWith('system:')
    && value !== 'ai-agent'
    && value !== 'schedule'
    && value !== 'migration-script'
}

function titleOf(data: Record<string, unknown>): string {
  for (const key of ['title', 'name', 'email', 'slug']) {
    if (typeof data[key] === 'string' && data[key].trim()) return String(data[key]).trim().slice(0, 120)
  }
  return ''
}

async function resolveProjectOwner(
  db: FirebaseFirestore.Firestore,
  projectId: string,
): Promise<{ uid: string; source: string } | null> {
  if (!projectId) return null
  const snap = await db.collection('projects').doc(projectId).get()
  if (!snap.exists) return null
  const data = snap.data() ?? {}
  for (const key of ['ownerUid', 'createdBy', 'reporterId']) {
    const value = data[key]
    if (isHumanUid(value)) return { uid: value, source: `project.${key}` }
  }
  return null
}

/** Client org with exactly one active human portal user → high-confidence owner. */
const orgOwnerCache = new Map<string, { uid: string; source: string } | null>()

async function resolveSingleOrgMember(
  db: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<{ uid: string; source: string } | null> {
  if (!orgId) return null
  if (orgOwnerCache.has(orgId)) return orgOwnerCache.get(orgId) ?? null

  // Prefer org memberships subcollection if present
  const membersSnap = await db.collection('organizations').doc(orgId).collection('members').limit(20).get()
  const memberUids = membersSnap.docs
    .map((doc) => {
      const data = doc.data()
      const uid = typeof data.userId === 'string' ? data.userId : doc.id
      return isHumanUid(uid) ? uid : ''
    })
    .filter(Boolean)

  if (memberUids.length === 1) {
    const result = { uid: memberUids[0]!, source: 'org.members.single' }
    orgOwnerCache.set(orgId, result)
    return result
  }

  // Fall back to users with activeOrgId/orgId match
  const byOrg = await db.collection('users').where('orgId', '==', orgId).limit(20).get()
  const byActive = await db.collection('users').where('activeOrgId', '==', orgId).limit(20).get()
  const uids = new Set<string>()
  for (const doc of [...byOrg.docs, ...byActive.docs]) {
    if (isHumanUid(doc.id)) uids.add(doc.id)
  }
  if (uids.size === 1) {
    const uid = Array.from(uids)[0]!
    const result = { uid, source: 'users.orgId.single' }
    orgOwnerCache.set(orgId, result)
    return result
  }

  orgOwnerCache.set(orgId, null)
  return null
}

async function resolveHumanOwner(
  db: FirebaseFirestore.Firestore,
  collection: string,
  data: Record<string, unknown>,
): Promise<{ uid: string; source: string } | null> {
  // Explicit share-of-one is weak; prefer project / org signals.
  const linked = (data.linked && typeof data.linked === 'object' && !Array.isArray(data.linked))
    ? data.linked as Record<string, unknown>
    : {}

  const projectId =
    (typeof linked.projectId === 'string' && linked.projectId)
    || (typeof data.projectId === 'string' && data.projectId)
    || ''
  if (projectId) {
    const fromProject = await resolveProjectOwner(db, projectId)
    if (fromProject) return fromProject
  }

  const clientOrgId =
    (typeof linked.clientOrgId === 'string' && linked.clientOrgId)
    || (typeof data.orgId === 'string' && data.orgId)
    || ''

  // For client_documents, prefer the linked client org over platform orgId
  if (collection === 'client_documents' && typeof linked.clientOrgId === 'string' && linked.clientOrgId) {
    const fromClient = await resolveSingleOrgMember(db, linked.clientOrgId)
    if (fromClient) return { ...fromClient, source: `linked.clientOrgId→${fromClient.source}` }
  }

  if (clientOrgId) {
    const fromOrg = await resolveSingleOrgMember(db, clientOrgId)
    if (fromOrg) return fromOrg
  }

  // CRM assigned owner when present and human
  for (const key of ['ownerUid', 'assignedTo', 'reporterId']) {
    if (isHumanUid(data[key])) return { uid: String(data[key]), source: key }
  }

  return null
}

export function buildPatch(input: {
  data: Record<string, unknown>
  human: { uid: string; source: string } | null
  stampOnly: boolean
}): { patch: Patch; action: RowReport['action']; reason: string } | null {
  const { data, human, stampOnly } = input
  const createdBy = typeof data.createdBy === 'string' ? data.createdBy : ''
  const updatedBy = typeof data.updatedBy === 'string' ? data.updatedBy : ''
  const existingCreatedAgent = typeof data.createdByAgentId === 'string' ? data.createdByAgentId.trim() : ''
  const existingUpdatedAgent = typeof data.updatedByAgentId === 'string' ? data.updatedByAgentId.trim() : ''
  const createdByType = data.createdByType

  const agentFromCreated = isAgentUid(createdBy) ? agentSlugFromUid(createdBy) : ''
  const agentFromUpdated = isAgentUid(updatedBy) ? agentSlugFromUid(updatedBy) : ''
  const needsAgentStamp =
    (Boolean(agentFromCreated) && !existingCreatedAgent)
    || (Boolean(agentFromUpdated) && !existingUpdatedAgent)
    || (createdByType === 'agent' && isAgentUid(createdBy) && !existingCreatedAgent)

  const needsOwnerFix = isAgentUid(createdBy) || createdByType === 'agent'
  const needsUpdatedOwnerFix = isAgentUid(updatedBy) || data.updatedByType === 'agent'

  if (!needsAgentStamp && !needsOwnerFix && !needsUpdatedOwnerFix) return null

  const patch: Patch = {}
  let action: RowReport['action'] = 'skip'
  let reason = ''

  if (agentFromCreated && !existingCreatedAgent) {
    patch.createdByAgentId = agentFromCreated
    action = 'stamp'
    reason = 'stamp createdByAgentId from createdBy'
  }
  if (agentFromUpdated && !existingUpdatedAgent) {
    patch.updatedByAgentId = agentFromUpdated
    action = action === 'skip' ? 'stamp' : action
    reason = reason || 'stamp updatedByAgentId from updatedBy'
  }

  if (!stampOnly && human && (needsOwnerFix || needsUpdatedOwnerFix)) {
    if (needsOwnerFix) {
      patch.createdBy = human.uid
      patch.createdByType = 'user'
      if (!patch.createdByAgentId && !existingCreatedAgent && agentFromCreated) {
        patch.createdByAgentId = agentFromCreated
      } else if (!patch.createdByAgentId && !existingCreatedAgent && isAgentUid(createdBy)) {
        patch.createdByAgentId = agentSlugFromUid(createdBy)
      }
    }
    if (needsUpdatedOwnerFix || needsOwnerFix) {
      if (isAgentUid(updatedBy) || !updatedBy || needsOwnerFix) {
        patch.updatedBy = human.uid
        patch.updatedByType = 'user'
      }
      if (!existingUpdatedAgent && !patch.updatedByAgentId) {
        const slug = agentFromUpdated || agentFromCreated
        if (slug) patch.updatedByAgentId = slug
      }
    }
    patch.ownershipReattributed = true
    patch.ownershipSource = human.source
    action = 'reattribute'
    reason = `reattribute owner via ${human.source}`
  } else if ((needsOwnerFix || needsUpdatedOwnerFix) && !human) {
    action = needsAgentStamp ? 'stamp' : 'skip'
    reason = needsAgentStamp
      ? 'stamp agent ids only; no high-confidence human owner'
      : 'no high-confidence human owner; left agent-owned'
  }

  if (Object.keys(patch).filter((k) => !k.startsWith('ownership')).length === 0) {
    return action === 'skip' ? null : { patch, action, reason }
  }

  // Strip bookkeeping keys that shouldn't be written to Firestore
  const firestorePatch: Patch = { ...patch }
  delete firestorePatch.ownershipReattributed
  delete firestorePatch.ownershipSource

  return {
    patch: {
      ...firestorePatch,
      ownershipReattributed: patch.ownershipReattributed,
      ownershipSource: patch.ownershipSource,
    },
    action,
    reason,
  }
}

function firestoreWritePatch(patch: Patch): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of [
    'createdBy',
    'createdByType',
    'createdByAgentId',
    'updatedBy',
    'updatedByType',
    'updatedByAgentId',
  ] as const) {
    if (patch[key] !== undefined) out[key] = patch[key]
  }
  return out
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

async function scanCollection(
  db: FirebaseFirestore.Firestore,
  collection: string,
  flags: CliFlags,
): Promise<RowReport[]> {
  const reports: RowReport[] = []
  let query: FirebaseFirestore.Query = db.collection(collection)
  if (flags.orgId) query = query.where('orgId', '==', flags.orgId)

  // Prefer agent-created query when possible; fall back to full scan filtered in memory.
  let snap: FirebaseFirestore.QuerySnapshot
  try {
    snap = await query.where('createdByType', '==', 'agent').get()
  } catch {
    snap = await query.limit(flags.limit > 0 ? flags.limit : 5000).get()
  }

  // Also catch createdBy=agent:* without type (legacy)
  let agentUidSnap: FirebaseFirestore.QuerySnapshot | null = null
  try {
    agentUidSnap = await (flags.orgId
      ? db.collection(collection).where('orgId', '==', flags.orgId).where('createdBy', '>=', 'agent:').where('createdBy', '<=', 'agent:\uf8ff')
      : db.collection(collection).where('createdBy', '>=', 'agent:').where('createdBy', '<=', 'agent:\uf8ff')
    ).get()
  } catch {
    agentUidSnap = null
  }

  const docs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>()
  for (const doc of snap.docs) docs.set(doc.id, doc)
  if (agentUidSnap) {
    for (const doc of agentUidSnap.docs) docs.set(doc.id, doc)
  }

  // If both queries returned little, do a broader sample for client_documents
  if (docs.size === 0 && collection === 'client_documents') {
    const broad = await db.collection(collection).limit(flags.limit > 0 ? flags.limit : 2000).get()
    for (const doc of broad.docs) docs.set(doc.id, doc)
  }

  let seen = 0
  for (const doc of docs.values()) {
    if (flags.limit > 0 && reports.length >= flags.limit) break
    seen += 1
    const data = doc.data() as Record<string, unknown>
    if (data.deleted === true) continue

    const createdBy = typeof data.createdBy === 'string' ? data.createdBy : ''
    const updatedBy = typeof data.updatedBy === 'string' ? data.updatedBy : ''
    const isAgentOwned =
      isAgentUid(createdBy)
      || isAgentUid(updatedBy)
      || data.createdByType === 'agent'
      || data.updatedByType === 'agent'
    if (!isAgentOwned) continue

    const human = flags.stampOnly ? null : await resolveHumanOwner(db, collection, data)
    const decided = buildPatch({ data, human, stampOnly: flags.stampOnly })
    if (!decided) continue

    reports.push({
      collection,
      id: doc.id,
      orgId: typeof data.orgId === 'string' ? data.orgId : '',
      title: titleOf(data),
      beforeCreatedBy: createdBy,
      beforeUpdatedBy: updatedBy,
      patch: decided.patch,
      action: decided.action,
      reason: decided.reason,
    })
  }

  console.log(`[${collection}] scanned≈${seen} candidate docs, ${reports.length} needing work`)
  return reports
}

async function applyPatches(
  db: FirebaseFirestore.Firestore,
  reports: RowReport[],
  batchSize: number,
): Promise<number> {
  let written = 0
  for (let i = 0; i < reports.length; i += batchSize) {
    const chunk = reports.slice(i, i + batchSize).filter((r) => r.action !== 'skip')
    if (chunk.length === 0) continue
    const batch = db.batch()
    for (const row of chunk) {
      const ref = db.collection(row.collection).doc(row.id)
      batch.update(ref, {
        ...firestoreWritePatch(row.patch),
        ownershipBackfilledAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      written += 1
    }
    await batch.commit()
  }
  return written
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  loadEnv()
  initAdmin()
  const db = admin.firestore()

  const collections = flags.collection
    ? [flags.collection]
    : [...DEFAULT_COLLECTIONS]

  console.log(`Mode: ${flags.dryRun ? 'DRY-RUN' : 'COMMIT'}${flags.stampOnly ? ' (stamp-only)' : ''}`)
  console.log(`Collections: ${collections.join(', ')}`)
  if (flags.orgId) console.log(`Org filter: ${flags.orgId}`)

  const all: RowReport[] = []
  for (const collection of collections) {
    const rows = await scanCollection(db, collection, flags)
    all.push(...rows)
  }

  const stamp = all.filter((r) => r.action === 'stamp').length
  const reattr = all.filter((r) => r.action === 'reattribute').length
  const skip = all.filter((r) => r.action === 'skip').length

  console.log('\nSummary')
  console.log(`  reattribute: ${reattr}`)
  console.log(`  stamp only:  ${stamp}`)
  console.log(`  skip:        ${skip}`)
  console.log(`  total:       ${all.length}`)

  const outDir = resolve(process.cwd(), 'scripts/backfill-reports')
  mkdirSync(outDir, { recursive: true })
  const stampIso = new Date().toISOString().replace(/[:.]/g, '-')
  const csvPath = resolve(outDir, `agent-ownership-${stampIso}.csv`)
  const header = [
    'collection', 'id', 'orgId', 'title', 'action', 'reason',
    'beforeCreatedBy', 'beforeUpdatedBy',
    'afterCreatedBy', 'afterUpdatedBy', 'createdByAgentId', 'updatedByAgentId', 'ownershipSource',
  ]
  const lines = [header.join(',')]
  for (const row of all) {
    lines.push([
      row.collection,
      row.id,
      row.orgId,
      row.title,
      row.action,
      row.reason,
      row.beforeCreatedBy,
      row.beforeUpdatedBy,
      row.patch.createdBy ?? row.beforeCreatedBy,
      row.patch.updatedBy ?? row.beforeUpdatedBy,
      row.patch.createdByAgentId ?? '',
      row.patch.updatedByAgentId ?? '',
      row.patch.ownershipSource ?? '',
    ].map(csvEscape).join(','))
  }
  writeFileSync(csvPath, lines.join('\n'))
  console.log(`\nReport: ${csvPath}`)

  if (flags.dryRun) {
    console.log('\nDry-run only. Re-run with --commit to write.')
    // Print a sample of reattributes for review
    const sample = all.filter((r) => r.action === 'reattribute').slice(0, 25)
    if (sample.length) {
      console.log('\nSample reattributes:')
      for (const row of sample) {
        console.log(
          `  ${row.collection}/${row.id}  ${row.beforeCreatedBy} → ${row.patch.createdBy}  (${row.reason})  ${row.title}`,
        )
      }
    }
    const stampSample = all.filter((r) => r.action === 'stamp').slice(0, 10)
    if (stampSample.length) {
      console.log('\nSample stamps (owner unchanged):')
      for (const row of stampSample) {
        console.log(
          `  ${row.collection}/${row.id}  createdBy=${row.beforeCreatedBy} +agentId=${row.patch.createdByAgentId ?? ''}  ${row.title}`,
        )
      }
    }
    return
  }

  const written = await applyPatches(db, all, flags.batchSize)
  console.log(`\nWrote ${written} updates.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
