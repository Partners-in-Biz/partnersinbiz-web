#!/usr/bin/env tsx
/**
 * Dry-run by default. Links existing PiB-owned invoices, quotes, and projects
 * back to the platform-owner CRM Company that represents their recipient org.
 *
 * Usage:
 *   npx tsx scripts/backfill-platform-owner-resource-company-links.ts
 *   npx tsx scripts/backfill-platform-owner-resource-company-links.ts --commit
 *   npx tsx scripts/backfill-platform-owner-resource-company-links.ts --org-id client-org
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import * as admin from 'firebase-admin'

export interface CliFlags {
  dryRun: boolean
  orgId?: string
  batchSize: number
}

export interface PlatformCompanyLink {
  companyId: string
  companyName: string
  linkedOrgId: string
}

export interface ResourceCompanyLinkRow {
  collection: 'invoices' | 'quotes' | 'projects'
  id: string
  recipientOrgId: string
  companyId: string
  action: 'link' | 'skip'
  reason: string
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

export function recipientOrgForResource(data: Record<string, unknown>): string {
  return cleanString(data.recipientOrgId) ||
    cleanString(data.targetOrgId) ||
    cleanString(data.clientOrgId) ||
    cleanString(data.legacyOrgId)
}

export function buildResourceCompanyPatch(
  collection: ResourceCompanyLinkRow['collection'],
  data: Record<string, unknown>,
  company: PlatformCompanyLink | undefined,
): { patch: Record<string, unknown>; reason: string } | null {
  if (!company) return null
  if (cleanString(data.companyId) === company.companyId && cleanString(data.sourceCompanyId) === company.companyId) {
    return null
  }

  const patch: Record<string, unknown> = {
    companyId: company.companyId,
    sourceCompanyId: company.companyId,
    recipientCompanyName: cleanString(data.recipientCompanyName) || company.companyName,
  }
  if (collection !== 'invoices') patch.companyName = company.companyName

  return { patch, reason: 'matched recipient org to platform CRM company' }
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

async function resolvePlatformOrgId(db: FirebaseFirestore.Firestore): Promise<string> {
  const snap = await db.collection('organizations').where('type', '==', 'platform_owner').limit(1).get()
  return snap.empty ? 'pib-platform-owner' : snap.docs[0].id
}

async function loadCompanyLinks(
  db: FirebaseFirestore.Firestore,
  platformOrgId: string,
  orgId?: string,
): Promise<Map<string, PlatformCompanyLink>> {
  const snap = await db.collection('companies').where('orgId', '==', platformOrgId).limit(5000).get()
  const byOrg = new Map<string, PlatformCompanyLink>()
  for (const doc of snap.docs) {
    const data = doc.data() ?? {}
    const linkedOrgId = cleanString(data.linkedOrgId)
    if (!linkedOrgId || data.deleted === true) continue
    if (orgId && linkedOrgId !== orgId) continue
    byOrg.set(linkedOrgId, {
      companyId: doc.id,
      companyName: cleanString(data.name) || linkedOrgId,
      linkedOrgId,
    })
  }
  return byOrg
}

async function scanCollection(input: {
  db: FirebaseFirestore.Firestore
  collectionName: ResourceCompanyLinkRow['collection']
  platformOrgId: string
  companiesByOrgId: Map<string, PlatformCompanyLink>
  orgId?: string
  dryRun: boolean
  batch: FirebaseFirestore.WriteBatch
  inBatch: number
  batchSize: number
}): Promise<{ rows: ResourceCompanyLinkRow[]; batch: FirebaseFirestore.WriteBatch; inBatch: number }> {
  const snap = await input.db.collection(input.collectionName)
    .where('orgId', '==', input.platformOrgId)
    .get()

  const rows: ResourceCompanyLinkRow[] = []
  let batch = input.batch
  let inBatch = input.inBatch

  for (const doc of snap.docs) {
    const data = doc.data() ?? {}
    const recipientOrgId = recipientOrgForResource(data)
    if (input.orgId && recipientOrgId !== input.orgId) continue
    const company = input.companiesByOrgId.get(recipientOrgId)
    const plan = buildResourceCompanyPatch(input.collectionName, data, company)
    if (!plan) {
      rows.push({
        collection: input.collectionName,
        id: doc.id,
        recipientOrgId,
        companyId: cleanString(data.companyId),
        action: 'skip',
        reason: company ? 'already linked' : 'no linked company for recipient org',
      })
      continue
    }

    rows.push({
      collection: input.collectionName,
      id: doc.id,
      recipientOrgId,
      companyId: company!.companyId,
      action: 'link',
      reason: plan.reason,
    })

    if (input.dryRun) continue
    batch.set(doc.ref, {
      ...plan.patch,
      companyLinkedAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true })
    inBatch += 1
    if (inBatch >= input.batchSize) {
      await batch.commit()
      batch = input.db.batch()
      inBatch = 0
    }
  }

  return { rows, batch, inBatch }
}

function writeReport(rows: ResourceCompanyLinkRow[], dryRun: boolean): string {
  const reportDir = resolve(process.cwd(), 'scripts/crm-backfill-reports')
  mkdirSync(reportDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = resolve(reportDir, `${stamp}-platform-owner-resource-company-links-${dryRun ? 'dryrun' : 'commit'}.csv`)
  const header: Array<keyof ResourceCompanyLinkRow> = ['collection', 'id', 'recipientOrgId', 'companyId', 'action', 'reason']
  const csv = [header.join(','), ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(','))].join('\n')
  writeFileSync(reportPath, `${csv}\n`)
  return reportPath
}

export async function run(flags: CliFlags): Promise<ResourceCompanyLinkRow[]> {
  loadEnv()
  const app = initAdmin()
  const db = app.firestore()
  const platformOrgId = await resolvePlatformOrgId(db)
  const companiesByOrgId = await loadCompanyLinks(db, platformOrgId, flags.orgId)
  let batch = db.batch()
  let inBatch = 0
  const rows: ResourceCompanyLinkRow[] = []

  for (const collectionName of ['invoices', 'quotes', 'projects'] as const) {
    const result = await scanCollection({
      db,
      collectionName,
      platformOrgId,
      companiesByOrgId,
      orgId: flags.orgId,
      dryRun: flags.dryRun,
      batch,
      inBatch,
      batchSize: flags.batchSize,
    })
    rows.push(...result.rows)
    batch = result.batch
    inBatch = result.inBatch
  }

  if (!flags.dryRun && inBatch > 0) await batch.commit()
  const reportPath = writeReport(rows, flags.dryRun)
  const linkCount = rows.filter((row) => row.action === 'link').length
  console.log(`Mode: ${flags.dryRun ? 'DRY-RUN (no writes)' : 'COMMITTED'}`)
  console.log(`Platform org: ${platformOrgId}`)
  console.log(`Rows scanned: ${rows.length}`)
  console.log(`Rows to link: ${linkCount}`)
  console.log(`Report: ${reportPath}`)
  return rows
}

if (require.main === module) {
  run(parseFlags(process.argv.slice(2))).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
