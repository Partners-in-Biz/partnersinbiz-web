#!/usr/bin/env tsx
/**
 * Dry-run by default. Links existing PiB-owned client_documents to the
 * platform-owner CRM company and linked client organisation they belong to.
 *
 * Usage:
 *   npx tsx scripts/backfill-platform-client-document-links.ts
 *   npx tsx scripts/backfill-platform-client-document-links.ts --commit
 *   npx tsx scripts/backfill-platform-client-document-links.ts --org-id client-org
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
  domain?: string
}

export interface PlatformClientDocumentRow {
  id: string
  orgId?: string
  title?: string
  linked?: Record<string, unknown>
}

export interface DocumentLinkPlan {
  action: 'link' | 'skip' | 'review_required'
  confidence: 'high' | 'low'
  companyId: string
  clientOrgId: string
  reason: string
}

export interface DocumentLinkReportRow extends DocumentLinkPlan {
  id: string
  orgId: string
  title: string
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeComparable(value: unknown): string {
  return cleanString(value)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function linkedValue(row: PlatformClientDocumentRow, field: string): string {
  return cleanString(row.linked?.[field])
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

export function buildDocumentLinkPlan(
  row: PlatformClientDocumentRow,
  companies: PlatformCompanyLink[],
): DocumentLinkPlan {
  const companyId = linkedValue(row, 'companyId')
  const clientOrgId = linkedValue(row, 'clientOrgId')
  if (companyId && clientOrgId) {
    return {
      action: 'skip',
      confidence: 'high',
      companyId,
      clientOrgId,
      reason: 'already linked',
    }
  }

  const title = normalizeComparable(row.title)
  const ownerOrgId = cleanString(row.orgId)
  const ownerOrgMatch = companies.find((company) => company.linkedOrgId === ownerOrgId)
  if (ownerOrgMatch) {
    return {
      action: 'link',
      confidence: 'high',
      companyId: ownerOrgMatch.companyId,
      clientOrgId: ownerOrgMatch.linkedOrgId,
      reason: 'matched document owner org to platform CRM company',
    }
  }

  const matches = companies.filter((company) => {
    const name = normalizeComparable(company.companyName)
    const domain = normalizeComparable(company.domain)
    return Boolean((name && title.includes(name)) || (domain && title.includes(domain)))
  })

  if (matches.length === 1) {
    const match = matches[0]
    return {
      action: 'link',
      confidence: 'high',
      companyId: match.companyId,
      clientOrgId: match.linkedOrgId,
      reason: 'matched company name in document title',
    }
  }

  return {
    action: 'review_required',
    confidence: 'low',
    companyId: '',
    clientOrgId: '',
    reason: matches.length > 1 ? 'ambiguous client/company match' : 'no confident client/company match',
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

async function loadCompanyLinks(
  db: FirebaseFirestore.Firestore,
  platformOrgId: string,
  orgId?: string,
): Promise<PlatformCompanyLink[]> {
  const snap = await db.collection('companies').where('orgId', '==', platformOrgId).limit(5000).get()
  const links: PlatformCompanyLink[] = []
  for (const doc of snap.docs) {
    const data = doc.data() ?? {}
    const linkedOrgId = cleanString(data.linkedOrgId)
    if (!linkedOrgId || data.deleted === true) continue
    if (linkedOrgId === platformOrgId) continue
    if (orgId && linkedOrgId !== orgId) continue
    links.push({
      companyId: doc.id,
      companyName: cleanString(data.name) || linkedOrgId,
      linkedOrgId,
      domain: cleanString(data.domain) || cleanString(data.website),
    })
  }
  return links
}

function writeReport(rows: DocumentLinkReportRow[], dryRun: boolean): string {
  const reportDir = resolve(process.cwd(), 'scripts/crm-backfill-reports')
  mkdirSync(reportDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = resolve(reportDir, `${stamp}-platform-client-document-links-${dryRun ? 'dryrun' : 'commit'}.csv`)
  const header: Array<keyof DocumentLinkReportRow> = [
    'id',
    'orgId',
    'title',
    'action',
    'confidence',
    'companyId',
    'clientOrgId',
    'reason',
  ]
  const csv = [header.join(','), ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(','))].join('\n')
  writeFileSync(reportPath, `${csv}\n`)
  return reportPath
}

export async function run(flags: CliFlags): Promise<DocumentLinkReportRow[]> {
  loadEnv()
  const app = initAdmin()
  const db = app.firestore()
  const platformOrgId = await resolvePlatformOrgId(db)
  const companies = await loadCompanyLinks(db, platformOrgId, flags.orgId)
  const snap = await db.collection('client_documents').where('orgId', '==', platformOrgId).get()
  const allDocsSnap = await db.collection('client_documents').get()
  const clientOrgIds = new Set(companies.map((company) => company.linkedOrgId))
  const rows: DocumentLinkReportRow[] = []
  let batch = db.batch()
  let inBatch = 0

  const candidateDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>()
  for (const doc of [...snap.docs, ...allDocsSnap.docs]) {
    const data = doc.data() ?? {}
    const ownerOrgId = cleanString(data.orgId)
    if (ownerOrgId !== platformOrgId && !clientOrgIds.has(ownerOrgId)) continue
    if (data.deleted === true) continue
    candidateDocs.set(doc.id, doc)
  }

  for (const doc of candidateDocs.values()) {
    const data = doc.data() ?? {}
    const plan = buildDocumentLinkPlan({
      id: doc.id,
      orgId: cleanString(data.orgId),
      title: cleanString(data.title),
      linked: data.linked && typeof data.linked === 'object' && !Array.isArray(data.linked)
        ? data.linked as Record<string, unknown>
        : {},
    }, companies)
    if (flags.orgId && plan.clientOrgId !== flags.orgId) continue
    rows.push({ id: doc.id, orgId: cleanString(data.orgId), title: cleanString(data.title), ...plan })

    if (flags.dryRun || plan.action !== 'link' || plan.confidence !== 'high') continue
    batch.set(doc.ref, {
      linked: {
        ...(data.linked && typeof data.linked === 'object' && !Array.isArray(data.linked) ? data.linked : {}),
        companyId: plan.companyId,
        clientOrgId: plan.clientOrgId,
      },
      linkedClientDocumentBackfilledAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true })
    inBatch += 1
    if (inBatch >= flags.batchSize) {
      await batch.commit()
      batch = db.batch()
      inBatch = 0
    }
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
