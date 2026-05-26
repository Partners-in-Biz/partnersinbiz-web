#!/usr/bin/env tsx
/**
 * Dry-run by default. Normalizes legacy PiB-issued commercial/project records:
 * invoices/quotes/projects become source-owned by pib-platform-owner and keep
 * the previous client org as recipientOrgId/targetOrgId.
 *
 * Usage:
 *   npx tsx scripts/migrate-pib-owned-client-resources.ts
 *   npx tsx scripts/migrate-pib-owned-client-resources.ts --commit
 *   npx tsx scripts/migrate-pib-owned-client-resources.ts --org-id client-org
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import * as admin from 'firebase-admin'

export interface CliFlags {
  dryRun: boolean
  orgId?: string
  batchSize: number
}

export interface MigrationRow {
  collection: 'invoices' | 'quotes' | 'projects'
  id: string
  previousOrgId: string
  recipientOrgId: string
  action: 'migrate' | 'skip'
  reason: string
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

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isPartnersInBizSender(data: Record<string, unknown>, platformOrgId: string): boolean {
  if (cleanString(data.billingOrgId) === platformOrgId) return true
  const fromDetails = asRecord(data.fromDetails)
  return cleanString(fromDetails.companyName).toLowerCase().includes('partners in biz')
}

export function buildCommercialOwnershipPatch(
  data: Record<string, unknown>,
  platformOrgId: string,
): { patch: Record<string, unknown>; reason: string } | null {
  const previousOrgId = cleanString(data.orgId)
  if (!previousOrgId) return null
  if (previousOrgId === platformOrgId) return null
  if (cleanString(data.sourceOrgId) === platformOrgId && cleanString(data.recipientOrgId)) return null
  if (!isPartnersInBizSender(data, platformOrgId)) return null

  return {
    reason: 'legacy PiB-issued commercial record',
    patch: {
      orgId: platformOrgId,
      sourceOrgId: platformOrgId,
      issuerOrgId: platformOrgId,
      billingOrgId: cleanString(data.billingOrgId) || platformOrgId,
      recipientOrgId: cleanString(data.recipientOrgId) || previousOrgId,
      targetOrgId: cleanString(data.targetOrgId) || cleanString(data.recipientOrgId) || previousOrgId,
      legacyOrgId: previousOrgId,
      claimStatus: cleanString(data.claimStatus) || 'claimed',
    },
  }
}

export function buildProjectOwnershipPatch(
  data: Record<string, unknown>,
  platformOrgId: string,
): { patch: Record<string, unknown>; reason: string } | null {
  const previousOrgId = cleanString(data.orgId)
  if (!previousOrgId) return null
  if (previousOrgId === platformOrgId) return null
  if (cleanString(data.sourceOrgId) === platformOrgId && cleanString(data.recipientOrgId)) return null

  return {
    reason: 'legacy client-org project',
    patch: {
      orgId: platformOrgId,
      sourceOrgId: platformOrgId,
      issuerOrgId: platformOrgId,
      recipientOrgId: cleanString(data.recipientOrgId) || previousOrgId,
      targetOrgId: cleanString(data.targetOrgId) || cleanString(data.recipientOrgId) || previousOrgId,
      clientOrgId: cleanString(data.clientOrgId) || previousOrgId,
      clientId: cleanString(data.clientId) || previousOrgId,
      legacyOrgId: previousOrgId,
      claimStatus: cleanString(data.claimStatus) || 'claimed',
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

async function scanCollection(input: {
  db: FirebaseFirestore.Firestore
  collectionName: MigrationRow['collection']
  platformOrgId: string
  orgId?: string
  dryRun: boolean
  batch: FirebaseFirestore.WriteBatch
  inBatch: number
  batchSize: number
}): Promise<{ rows: MigrationRow[]; batch: FirebaseFirestore.WriteBatch; inBatch: number }> {
  let query: FirebaseFirestore.Query = input.db.collection(input.collectionName)
  if (input.orgId) query = query.where('orgId', '==', input.orgId)
  const snap = await query.get()
  let batch = input.batch
  let inBatch = input.inBatch
  const rows: MigrationRow[] = []

  for (const doc of snap.docs) {
    const data = doc.data() ?? {}
    const plan = input.collectionName === 'projects'
      ? buildProjectOwnershipPatch(data, input.platformOrgId)
      : buildCommercialOwnershipPatch(data, input.platformOrgId)
    if (!plan) {
      rows.push({
        collection: input.collectionName,
        id: doc.id,
        previousOrgId: cleanString(data.orgId),
        recipientOrgId: cleanString(data.recipientOrgId),
        action: 'skip',
        reason: 'already canonical or not PiB-owned',
      })
      continue
    }

    rows.push({
      collection: input.collectionName,
      id: doc.id,
      previousOrgId: cleanString(data.orgId),
      recipientOrgId: cleanString(plan.patch.recipientOrgId),
      action: 'migrate',
      reason: plan.reason,
    })

    if (input.dryRun) continue
    batch.set(doc.ref, {
      ...plan.patch,
      ownershipMigratedAt: admin.firestore.Timestamp.now(),
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

function writeReport(rows: MigrationRow[], dryRun: boolean): string {
  const reportDir = resolve(process.cwd(), 'scripts/crm-backfill-reports')
  mkdirSync(reportDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = resolve(reportDir, `${stamp}-pib-owned-client-resources-${dryRun ? 'dryrun' : 'commit'}.csv`)
  const header: Array<keyof MigrationRow> = ['collection', 'id', 'previousOrgId', 'recipientOrgId', 'action', 'reason']
  const csv = [header.join(','), ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(','))].join('\n')
  writeFileSync(reportPath, `${csv}\n`)
  return reportPath
}

export async function run(flags: CliFlags): Promise<MigrationRow[]> {
  loadEnv()
  const app = initAdmin()
  const db = app.firestore()
  const platformOrgId = await resolvePlatformOrgId(db)
  let batch = db.batch()
  let inBatch = 0
  const rows: MigrationRow[] = []

  for (const collectionName of ['invoices', 'quotes', 'projects'] as const) {
    const result = await scanCollection({
      db,
      collectionName,
      platformOrgId,
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
  const migrateCount = rows.filter((row) => row.action === 'migrate').length
  console.log(`Mode: ${flags.dryRun ? 'DRY-RUN (no writes)' : 'COMMITTED'}`)
  console.log(`Platform org: ${platformOrgId}`)
  console.log(`Rows scanned: ${rows.length}`)
  console.log(`Rows to migrate: ${migrateCount}`)
  console.log(`Report: ${reportPath}`)
  return rows
}

if (require.main === module) {
  run(parseFlags(process.argv.slice(2))).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
