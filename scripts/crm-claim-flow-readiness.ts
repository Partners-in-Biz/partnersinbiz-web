#!/usr/bin/env tsx
/**
 * Dry-run by default. Backfills the two prerequisites the CRM claim flow needs:
 * orgMembers docs for legacy organization.members entries, and one default CRM
 * pipeline per org.
 *
 * Usage:
 *   npx tsx scripts/crm-claim-flow-readiness.ts
 *   npx tsx scripts/crm-claim-flow-readiness.ts --commit
 *   npx tsx scripts/crm-claim-flow-readiness.ts --org-id acme
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import * as admin from 'firebase-admin'
import type {
  DocumentSnapshot,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore'

const VALID_ROLES = new Set(['owner', 'admin', 'member', 'viewer'])

const DEFAULT_STAGES = [
  { id: 'discovery', label: 'Discovery', kind: 'open', order: 0, probability: 10 },
  { id: 'proposal', label: 'Proposal', kind: 'open', order: 1, probability: 30 },
  { id: 'negotiation', label: 'Negotiation', kind: 'open', order: 2, probability: 70 },
  { id: 'won', label: 'Won', kind: 'won', order: 3, probability: 100 },
  { id: 'lost', label: 'Lost', kind: 'lost', order: 4, probability: 0 },
]

const PIP_REF = {
  uid: 'agent:pip',
  displayName: 'Pip',
  kind: 'agent',
}

export interface CliFlags {
  dryRun: boolean
  orgId?: string
  batchSize: number
}

export interface MemberBackfill {
  key: string
  orgId: string
  uid: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
}

export function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: true, batchSize: 300 }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--commit') flags.dryRun = false
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--org-id') flags.orgId = argv[++i]
    else if (arg === '--batch-size') flags.batchSize = Number.parseInt(argv[++i] ?? '300', 10)
  }
  return flags
}

export function buildOrgMemberBackfillPlan(
  orgId: string,
  members: unknown,
  existingKeys: Set<string>,
): MemberBackfill[] {
  if (!Array.isArray(members)) return []

  return members.flatMap((member): MemberBackfill[] => {
    if (!member || typeof member !== 'object') return []
    const source = member as Record<string, unknown>
    const uid = typeof source.userId === 'string' ? source.userId.trim() : ''
    const role = typeof source.role === 'string' && VALID_ROLES.has(source.role)
      ? source.role as MemberBackfill['role']
      : 'member'
    const key = `${orgId}_${uid}`
    if (!uid || existingKeys.has(key)) return []
    return [{ key, orgId, uid, role }]
  })
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
    const value = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '')
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

function csvEscape(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  loadEnv()
  const admin = initAdmin()
  const db = admin.firestore()
  const now = admin.firestore.Timestamp.now()

  const orgDocs: Array<DocumentSnapshot | QueryDocumentSnapshot> = flags.orgId
    ? [(await db.collection('organizations').doc(flags.orgId).get())].filter((doc) => doc.exists)
    : (await db.collection('organizations').get()).docs

  const rows: Array<Record<string, unknown>> = []
  let batch = db.batch()
  let inBatch = 0

  for (const orgDoc of orgDocs) {
    const org = orgDoc.data() ?? {}
    const orgId = orgDoc.id
    const existingMemberSnap = await db.collection('orgMembers').where('orgId', '==', orgId).get()
    const existingKeys = new Set(existingMemberSnap.docs.map((doc) => doc.id))
    const memberPlan = buildOrgMemberBackfillPlan(orgId, org.members, existingKeys)

    const pipelinesSnap = await db.collection('pipelines').where('orgId', '==', orgId).limit(50).get()
    const activePipelines = pipelinesSnap.docs.filter((doc) => doc.data()?.deleted !== true)
    const defaultPipeline = activePipelines.find((doc) => doc.data()?.isDefault === true)
    const needsPipeline = activePipelines.length === 0
    const needsDefaultMark = activePipelines.length > 0 && !defaultPipeline

    rows.push({
      orgId,
      orgName: org.name ?? '',
      missingOrgMembers: memberPlan.length,
      needsPipeline: needsPipeline ? 1 : 0,
      needsDefaultMark: needsDefaultMark ? 1 : 0,
    })

    if (flags.dryRun) continue

    for (const item of memberPlan) {
      const userDoc = await db.collection('users').doc(item.uid).get()
      const user = userDoc.exists ? userDoc.data() ?? {} : {}
      const displayName = typeof user.displayName === 'string' ? user.displayName.trim() : ''
      const [firstName = '', ...rest] = displayName.split(/\s+/).filter(Boolean)
      batch.set(db.collection('orgMembers').doc(item.key), {
        orgId: item.orgId,
        uid: item.uid,
        firstName,
        lastName: rest.join(' '),
        role: item.role,
        createdAt: now,
        updatedAt: now,
      }, { merge: true })
      inBatch += 1
      if (inBatch >= flags.batchSize) {
        await batch.commit()
        batch = db.batch()
        inBatch = 0
      }
    }

    if (needsPipeline) {
      batch.set(db.collection('pipelines').doc(), {
        orgId,
        name: 'Default Pipeline',
        stages: DEFAULT_STAGES,
        isDefault: true,
        archived: false,
        createdBy: PIP_REF.uid,
        createdByRef: PIP_REF,
        updatedBy: PIP_REF.uid,
        updatedByRef: PIP_REF,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      })
      inBatch += 1
    } else if (needsDefaultMark) {
      batch.update(activePipelines[0].ref, { isDefault: true, updatedAt: now })
      inBatch += 1
    }
  }

  if (!flags.dryRun && inBatch > 0) await batch.commit()

  const reportDir = resolve(process.cwd(), 'scripts/crm-backfill-reports')
  mkdirSync(reportDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = resolve(reportDir, `${stamp}-claim-flow-readiness-${flags.dryRun ? 'dryrun' : 'commit'}.csv`)
  const header = ['orgId', 'orgName', 'missingOrgMembers', 'needsPipeline', 'needsDefaultMark']
  const csv = [header.join(','), ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(','))].join('\n')
  writeFileSync(reportPath, `${csv}\n`)

  console.log(`Mode: ${flags.dryRun ? 'DRY-RUN (no writes)' : 'COMMITTED'}`)
  console.log(`Orgs scanned: ${rows.length}`)
  console.log(`Report: ${reportPath}`)
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
