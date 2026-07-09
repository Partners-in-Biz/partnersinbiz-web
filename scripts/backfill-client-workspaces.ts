#!/usr/bin/env tsx
/**
 * Dry-run by default. Backfills VPS-canonical PiB Workspaces for existing
 * client organisations by rebuilding the same provisioning manifest used by
 * POST /api/v1/organizations.
 *
 * Usage:
 *   npx tsx scripts/backfill-client-workspaces.ts
 *   npx tsx scripts/backfill-client-workspaces.ts --commit
 *   npx tsx scripts/backfill-client-workspaces.ts --org-id client-org
 *   npx tsx scripts/backfill-client-workspaces.ts --commit --skip-vps
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import * as admin from 'firebase-admin'
import { buildClientProvisioningPayload, inferAgentName } from '@/lib/client-provisioning/provisioner'
import { provisionFullClientOnVps } from '@/lib/client-provisioning/vps'
import { workspaceRecordFromManifest, ORG_WORKSPACES_COLLECTION } from '@/lib/client-provisioning/workspace-context'
import { slugify } from '@/lib/organizations/helpers'

export interface CliFlags {
  dryRun: boolean
  orgId?: string
  limit?: number
  skipVps: boolean
}

export interface CrmWorkspaceLinks {
  companyId: string | null
  contactIds: string[]
}

export interface ClientWorkspaceBackfillRow {
  orgId: string
  orgName: string
  orgSlug: string
  workspaceId: string
  action: 'backfill' | 'repair' | 'skip' | 'review_required'
  wouldCallVps: boolean
  companyId: string
  contactIds: string
  reason: string
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isActiveClientOrg(orgId: string, org: Record<string, unknown>, platformOrgId: string): boolean {
  if (orgId === platformOrgId) return false
  if (org.deleted === true || org.active === false) return false
  return cleanString(org.type) === 'client'
}

export function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: true, skipVps: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--commit' || arg === '--apply') flags.dryRun = false
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--org-id') flags.orgId = argv[++i]
    else if (arg === '--limit') flags.limit = Number.parseInt(argv[++i] ?? '', 10)
    else if (arg === '--skip-vps') flags.skipVps = true
  }
  return flags
}

export function classifyWorkspaceBackfill(input: {
  org: Record<string, unknown>
  workspaceDocExists: boolean
}): Pick<ClientWorkspaceBackfillRow, 'action' | 'reason'> {
  const hasOrgManifest = Boolean(input.org.workspaceManifest)
  const hasOrgWorkspaceId = Boolean(cleanString(input.org.workspaceId))
  if (hasOrgManifest && hasOrgWorkspaceId && input.workspaceDocExists) {
    return { action: 'skip', reason: 'workspace manifest and org_workspaces record already exist' }
  }
  if (hasOrgManifest || hasOrgWorkspaceId || input.workspaceDocExists) {
    return { action: 'repair', reason: 'partial workspace metadata exists; repair missing fields' }
  }
  return { action: 'backfill', reason: 'missing workspace manifest and org_workspaces record' }
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

async function resolveCrmWorkspaceLinks(
  db: FirebaseFirestore.Firestore,
  platformOrgId: string,
  clientOrgId: string,
): Promise<CrmWorkspaceLinks> {
  const companySnap = await db.collection('companies')
    .where('orgId', '==', platformOrgId)
    .where('linkedOrgId', '==', clientOrgId)
    .limit(2)
    .get()

  if (companySnap.docs.length !== 1) return { companyId: null, contactIds: [] }
  const companyId = companySnap.docs[0].id
  const contactSnap = await db.collection('contacts')
    .where('orgId', '==', platformOrgId)
    .where('companyId', '==', companyId)
    .limit(50)
    .get()
  const contactIds = contactSnap.docs
    .filter((doc) => doc.data()?.deleted !== true)
    .map((doc) => doc.id)
    .sort()

  return { companyId, contactIds }
}

function writeReport(rows: ClientWorkspaceBackfillRow[], dryRun: boolean): string {
  const reportDir = resolve(process.cwd(), 'scripts/client-workspace-backfill-reports')
  mkdirSync(reportDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = resolve(reportDir, `${stamp}-client-workspaces-${dryRun ? 'dryrun' : 'commit'}.csv`)
  const header: Array<keyof ClientWorkspaceBackfillRow> = [
    'orgId',
    'orgName',
    'orgSlug',
    'workspaceId',
    'action',
    'wouldCallVps',
    'companyId',
    'contactIds',
    'reason',
  ]
  const csv = [header.join(','), ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(','))].join('\n')
  writeFileSync(reportPath, `${csv}\n`)
  return reportPath
}

async function loadCandidateOrgDocs(
  db: FirebaseFirestore.Firestore,
  flags: CliFlags,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  if (flags.orgId) {
    const doc = await db.collection('organizations').doc(flags.orgId).get()
    return doc.exists ? [doc as FirebaseFirestore.QueryDocumentSnapshot] : []
  }

  const snap = await db.collection('organizations').get()
  const docs = snap.docs
  return typeof flags.limit === 'number' && Number.isFinite(flags.limit) && flags.limit > 0
    ? docs.slice(0, flags.limit)
    : docs
}

export async function run(flags: CliFlags): Promise<ClientWorkspaceBackfillRow[]> {
  loadEnv()
  const app = initAdmin()
  const db = app.firestore()
  db.settings({ ignoreUndefinedProperties: true })
  const platformOrgId = await resolvePlatformOrgId(db)
  const orgDocs = await loadCandidateOrgDocs(db, flags)
  const rows: ClientWorkspaceBackfillRow[] = []

  for (const orgDoc of orgDocs) {
    const orgId = orgDoc.id
    const org = orgDoc.data() ?? {}
    if (!isActiveClientOrg(orgId, org, platformOrgId)) continue

    const orgName = cleanString(org.name) || cleanString(org.displayName) || orgId
    const orgSlug = cleanString(org.slug) || slugify(orgName)
    if (!orgSlug) {
      rows.push({
        orgId,
        orgName,
        orgSlug,
        workspaceId: '',
        action: 'review_required',
        wouldCallVps: false,
        companyId: '',
        contactIds: '',
        reason: 'could not derive org slug/workspace id',
      })
      continue
    }

    const workspaceDoc = await db.collection(ORG_WORKSPACES_COLLECTION).doc(orgSlug).get()
    const classification = classifyWorkspaceBackfill({ org, workspaceDocExists: workspaceDoc.exists })
    const links = await resolveCrmWorkspaceLinks(db, platformOrgId, orgId)
    const rowBase = {
      orgId,
      orgName,
      orgSlug,
      workspaceId: orgSlug,
      companyId: links.companyId ?? '',
      contactIds: links.contactIds.join('|'),
    }

    if (classification.action === 'skip') {
      rows.push({ ...rowBase, action: 'skip', wouldCallVps: false, reason: classification.reason })
      continue
    }

    const agentName = cleanString(org.provisioning && typeof org.provisioning === 'object'
      ? (org.provisioning as Record<string, unknown>).agentName
      : undefined) || inferAgentName(orgName)
    const payload = buildClientProvisioningPayload({
      clientName: orgName,
      domain: orgSlug,
      orgId,
      agentName,
      companyId: links.companyId,
      contactIds: links.contactIds,
    })

    rows.push({
      ...rowBase,
      action: classification.action,
      wouldCallVps: !flags.skipVps,
      reason: classification.reason,
    })

    if (flags.dryRun) continue

    let provisioningResult: unknown = { skipped: true, reason: '--skip-vps' }
    if (!flags.skipVps) {
      provisioningResult = await provisionFullClientOnVps({
        clientName: orgName,
        domain: orgSlug,
        orgId,
        agentName,
        companyId: links.companyId,
        contactIds: links.contactIds,
      })
    }

    const workspaceRecord = workspaceRecordFromManifest(payload.manifest)
    const workspaceRef = db.collection(ORG_WORKSPACES_COLLECTION).doc(payload.manifest.workspaceId)
    const existingWorkspace = await workspaceRef.get()
    await workspaceRef.set({
      ...workspaceRecord,
      ...(!existingWorkspace.exists ? { createdAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
    }, { merge: true })

    await orgDoc.ref.set({
      folderRegistry: payload.folderRegistry,
      workspaceId: payload.manifest.workspaceId,
      workspaceManifest: payload.manifest,
      provisioning: {
        ...(org.provisioning && typeof org.provisioning === 'object' ? org.provisioning : {}),
        status: flags.skipVps ? 'metadata_backfilled' : 'complete',
        domain: orgSlug,
        agentName,
        workspaceId: payload.manifest.workspaceId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        backfilledAt: admin.firestore.FieldValue.serverTimestamp(),
        result: provisioningResult,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })
  }

  const reportPath = writeReport(rows, flags.dryRun)
  console.log(`Mode: ${flags.dryRun ? 'DRY-RUN (no writes)' : 'COMMITTED'}`)
  console.log(`Platform org: ${platformOrgId}`)
  console.log(`Rows: ${rows.length}`)
  console.log(`Backfill: ${rows.filter((row) => row.action === 'backfill').length}`)
  console.log(`Repair: ${rows.filter((row) => row.action === 'repair').length}`)
  console.log(`Skipped: ${rows.filter((row) => row.action === 'skip').length}`)
  console.log(`Review required: ${rows.filter((row) => row.action === 'review_required').length}`)
  console.log(`Report: ${reportPath}`)
  return rows
}

if (require.main === module) {
  run(parseFlags(process.argv.slice(2))).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
