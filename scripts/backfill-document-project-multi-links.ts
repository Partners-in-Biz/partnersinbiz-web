#!/usr/bin/env tsx
/**
 * Dry-run by default. Prepares Phase 5 by mirroring existing scalar
 * client document/project links into their multi-link array fields.
 *
 * Usage:
 *   npx tsx scripts/backfill-document-project-multi-links.ts
 *   npx tsx scripts/backfill-document-project-multi-links.ts --org-id client-org
 *   npx tsx scripts/backfill-document-project-multi-links.ts --commit --approval-task-id TASK_ID --approval-evidence "Peet approval evidence..."
 *
 * Commit mode is live data mutation and is intentionally approval-gated.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import * as admin from 'firebase-admin'

type CollectionName = 'client_documents' | 'projects'
type Patch = Record<string, unknown>

type ScalarArrayPair = {
  scalarField: string
  arrayField: string
}

export interface CliFlags {
  dryRun: boolean
  orgId?: string
  batchSize: number
  approvalTaskId?: string
  approvalEvidence?: string
}

export interface ArrayMirrorReportRow {
  collection: CollectionName
  id: string
  orgId: string
  title: string
  action: 'mirror' | 'skip'
  fieldPairs: string[]
  reason: string
}

const DOCUMENT_LINKED_PAIRS: ScalarArrayPair[] = [
  { scalarField: 'companyId', arrayField: 'companyIds' },
  { scalarField: 'contactId', arrayField: 'contactIds' },
  { scalarField: 'clientOrgId', arrayField: 'clientOrgIds' },
  { scalarField: 'projectId', arrayField: 'projectIds' },
  { scalarField: 'dealId', arrayField: 'dealIds' },
]

const PROJECT_LINKED_PAIRS: ScalarArrayPair[] = [
  { scalarField: 'clientOrgId', arrayField: 'clientOrgIds' },
  { scalarField: 'companyId', arrayField: 'companyIds' },
  { scalarField: 'contactId', arrayField: 'contactIds' },
  { scalarField: 'sourceCompanyId', arrayField: 'sourceCompanyIds' },
  { scalarField: 'sourceContactId', arrayField: 'sourceContactIds' },
  { scalarField: 'recipientOrgId', arrayField: 'recipientOrgIds' },
]

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => cleanString(item))
    .filter(Boolean)
}

function buildArrayMirrorPatch(input: Record<string, unknown>, pairs: ScalarArrayPair[]): Patch | null {
  const patch: Patch = {}

  for (const pair of pairs) {
    const scalar = cleanString(input[pair.scalarField])
    if (!scalar) continue

    const existing = cleanStringArray(input[pair.arrayField])
    if (existing.includes(scalar)) continue

    patch[pair.arrayField] = Array.from(new Set([...existing, scalar]))
  }

  return Object.keys(patch).length > 0 ? patch : null
}

export function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: true, batchSize: 300 }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--commit') flags.dryRun = false
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--org-id') flags.orgId = argv[++i]
    else if (arg === '--batch-size') flags.batchSize = Number.parseInt(argv[++i] ?? '300', 10)
    else if (arg === '--approval-task-id') flags.approvalTaskId = argv[++i]
    else if (arg === '--approval-evidence') flags.approvalEvidence = argv[++i]
  }
  return flags
}

export function assertCommitApproved(flags: CliFlags): void {
  if (flags.dryRun) return
  if (!cleanString(flags.approvalTaskId) || !cleanString(flags.approvalEvidence)) {
    throw new Error('Commit mode requires --approval-task-id and --approval-evidence. Do not run live backfill without an explicit approved task/evidence record.')
  }
}

export function buildDocumentArrayMirrorPatch(data: Record<string, unknown>): Patch | null {
  const linked = data.linked && typeof data.linked === 'object' && !Array.isArray(data.linked)
    ? data.linked as Record<string, unknown>
    : {}
  const linkedPatch = buildArrayMirrorPatch(linked, DOCUMENT_LINKED_PAIRS)
  return linkedPatch ? { linked: linkedPatch } : null
}

export function buildProjectArrayMirrorPatch(data: Record<string, unknown>): Patch | null {
  return buildArrayMirrorPatch(data, PROJECT_LINKED_PAIRS)
}

function patchFieldPairs(patch: Patch, collection: CollectionName): string[] {
  const pairs = collection === 'client_documents' ? DOCUMENT_LINKED_PAIRS : PROJECT_LINKED_PAIRS
  const target = collection === 'client_documents'
    ? (patch.linked && typeof patch.linked === 'object' && !Array.isArray(patch.linked) ? patch.linked as Patch : {})
    : patch

  return pairs
    .filter((pair) => Object.prototype.hasOwnProperty.call(target, pair.arrayField))
    .map((pair) => `${pair.scalarField}->${pair.arrayField}`)
}

function mergeDocumentPatch(data: Record<string, unknown>, patch: Patch): Patch {
  const linked = data.linked && typeof data.linked === 'object' && !Array.isArray(data.linked)
    ? data.linked as Record<string, unknown>
    : {}
  const linkedPatch = patch.linked && typeof patch.linked === 'object' && !Array.isArray(patch.linked)
    ? patch.linked as Patch
    : {}
  return {
    linked: {
      ...linked,
      ...linkedPatch,
    },
  }
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
    admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) })
  } else {
    admin.initializeApp({ credential: admin.credential.applicationDefault() })
  }

  return admin
}

function csvEscape(value: unknown): string {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

async function scanCollection(input: {
  db: FirebaseFirestore.Firestore
  collectionName: CollectionName
  flags: CliFlags
  batch: FirebaseFirestore.WriteBatch
  inBatch: number
}): Promise<{ rows: ArrayMirrorReportRow[]; batch: FirebaseFirestore.WriteBatch; inBatch: number }> {
  const snap = await input.db.collection(input.collectionName).get()
  const rows: ArrayMirrorReportRow[] = []
  let batch = input.batch
  let inBatch = input.inBatch

  for (const doc of snap.docs) {
    const data = doc.data() ?? {}
    const orgId = cleanString(data.orgId)
    if (input.flags.orgId && orgId !== input.flags.orgId) continue
    if (data.deleted === true) continue

    const patch = input.collectionName === 'client_documents'
      ? buildDocumentArrayMirrorPatch(data)
      : buildProjectArrayMirrorPatch(data)
    const fieldPairs = patch ? patchFieldPairs(patch, input.collectionName) : []

    if (!patch) {
      rows.push({
        collection: input.collectionName,
        id: doc.id,
        orgId,
        title: cleanString(data.title) || cleanString(data.name),
        action: 'skip',
        fieldPairs: [],
        reason: 'no missing array mirrors for scalar links',
      })
      continue
    }

    rows.push({
      collection: input.collectionName,
      id: doc.id,
      orgId,
      title: cleanString(data.title) || cleanString(data.name),
      action: 'mirror',
      fieldPairs,
      reason: 'scalar link would be mirrored into array link field',
    })

    if (input.flags.dryRun) continue

    const writePatch = input.collectionName === 'client_documents'
      ? mergeDocumentPatch(data, patch)
      : patch
    batch.set(doc.ref, {
      ...writePatch,
      multiLinkBackfilledAt: admin.firestore.Timestamp.now(),
      multiLinkBackfillApprovalTaskId: input.flags.approvalTaskId,
      multiLinkBackfillApprovalEvidence: input.flags.approvalEvidence,
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true })
    inBatch += 1
    if (inBatch >= input.flags.batchSize) {
      await batch.commit()
      batch = input.db.batch()
      inBatch = 0
    }
  }

  return { rows, batch, inBatch }
}

export async function runWithDb(
  db: FirebaseFirestore.Firestore,
  flags: CliFlags,
): Promise<ArrayMirrorReportRow[]> {
  assertCommitApproved(flags)
  let batch = db.batch()
  let inBatch = 0
  const rows: ArrayMirrorReportRow[] = []

  for (const collectionName of ['client_documents', 'projects'] as const) {
    const result = await scanCollection({ db, collectionName, flags, batch, inBatch })
    rows.push(...result.rows)
    batch = result.batch
    inBatch = result.inBatch
  }

  if (!flags.dryRun && inBatch > 0) await batch.commit()
  return rows
}

function writeReport(rows: ArrayMirrorReportRow[], dryRun: boolean): string {
  const reportDir = resolve(process.cwd(), 'scripts/crm-backfill-reports')
  mkdirSync(reportDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = resolve(reportDir, `${stamp}-document-project-multi-links-${dryRun ? 'dryrun' : 'commit'}.csv`)
  const header: Array<keyof ArrayMirrorReportRow> = ['collection', 'id', 'orgId', 'title', 'action', 'fieldPairs', 'reason']
  const csv = [header.join(','), ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(','))].join('\n')
  writeFileSync(reportPath, `${csv}\n`)
  return reportPath
}

export async function run(flags: CliFlags): Promise<ArrayMirrorReportRow[]> {
  loadEnv()
  const app = initAdmin()
  const rows = await runWithDb(app.firestore(), flags)
  const mirrorCount = rows.filter((row) => row.action === 'mirror').length
  const reportPath = writeReport(rows, flags.dryRun)
  console.log(`Mode: ${flags.dryRun ? 'DRY-RUN (no writes)' : 'COMMITTED'}`)
  console.log(`Rows scanned: ${rows.length}`)
  console.log(`Documents/projects to mirror: ${mirrorCount}`)
  console.log(`Report: ${reportPath}`)
  if (!flags.dryRun) {
    console.log(`Approval task: ${flags.approvalTaskId}`)
  }
  return rows
}

if (require.main === module) {
  run(parseFlags(process.argv.slice(2))).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
