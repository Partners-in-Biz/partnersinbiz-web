#!/usr/bin/env tsx
/**
 * Backfill canonical company_workspace PartnerResourceGrants for every linked
 * CRM company (companies.linkedOrgId set) that already has an active
 * PartnerLink between the two orgs.
 *
 * Dry-run by default. Hydrates a CanonicalMigrationSnapshot from Firestore,
 * runs the pure planner in lib/cross-org/migration.ts, writes evidence files,
 * and only mutates Firestore with --commit. Never deletes anything.
 *
 * Usage:
 *   npx tsx scripts/backfill-company-workspace-grants.ts            # dry-run
 *   npx tsx scripts/backfill-company-workspace-grants.ts --commit   # apply
 *   npx tsx scripts/backfill-company-workspace-grants.ts --out-dir tmp/x
 *
 * Credentials: service-account.json in cwd, FIREBASE_ADMIN_* env (or .env.local),
 * or application-default credentials.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as admin from 'firebase-admin'
import {
  applyMigrationPlan,
  buildCanonicalMigrationPlan,
  type CanonicalMigrationSnapshot,
  type LinkedCompanyMigrationRow,
  type MigrationMode,
  type MigrationOperation,
} from '../lib/cross-org/migration'
import type { SharedBusinessCapability } from '../lib/business-relationships/types'
import type { PartnerLink, PartnerResourceGrant } from '../lib/cross-org/types'

const PARTNER_LINKS = 'partnerLinks'
const GRANTS = 'partnerResourceGrants'
const RELATIONSHIPS = 'businessRelationships'
const SCHEMA_VERSION = 1
const DEFAULT_MODULES: SharedBusinessCapability[] = [
  'crm', 'projects', 'documents', 'campaigns', 'social', 'email', 'seo', 'ads', 'research', 'services', 'support', 'messages',
]

interface Flags {
  mode: MigrationMode
  outDir: string
  help: boolean
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    mode: 'dry-run',
    outDir: resolve(process.cwd(), 'tmp/company-workspace-backfill'),
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--commit') flags.mode = 'apply'
    else if (arg === '--dry-run') flags.mode = 'dry-run'
    else if (arg === '--out-dir') flags.outDir = resolve(process.cwd(), argv[++i] ?? flags.outDir)
    else if (arg === '--help' || arg === '-h') flags.help = true
  }
  return flags
}

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}

function initAdmin(): FirebaseFirestore.Firestore {
  if (admin.apps.length === 0) {
    const keyPath = resolve(process.cwd(), 'service-account.json')
    const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim()
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim()
    const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n').trim()
    if (existsSync(keyPath)) {
      const sa = JSON.parse(readFileSync(keyPath, 'utf8')) as admin.ServiceAccount
      admin.initializeApp({ credential: admin.credential.cert(sa) })
    } else if (projectId && clientEmail && privateKey) {
      admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) })
    } else {
      admin.initializeApp({ credential: admin.credential.applicationDefault() })
    }
  }
  return admin.firestore()
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function hydrateSnapshot(db: FirebaseFirestore.Firestore): Promise<{
  snapshot: CanonicalMigrationSnapshot
  stats: Record<string, number>
}> {
  const [companiesSnap, linksSnap, grantsSnap, relationshipsSnap, platformSnap] = await Promise.all([
    db.collection('companies').where('linkedOrgId', '!=', '').limit(5000).get(),
    db.collection(PARTNER_LINKS).where('status', '==', 'active').limit(5000).get(),
    db.collection(GRANTS).where('resourceType', '==', 'company_workspace').limit(5000).get(),
    db.collection(RELATIONSHIPS).limit(10000).get(),
    db.collection('organizations').where('type', '==', 'platform_owner').limit(1).get(),
  ])
  const platformOrgId = platformSnap.empty ? 'pib-platform-owner' : platformSnap.docs[0].id

  const existingLinks = linksSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PartnerLink)
  const existingGrants = grantsSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as PartnerResourceGrant)
    .filter((grant) => grant.status === 'active')

  // (sourceOrgId, sourceCompanyId) → relationship row with explicit sharedCapabilities.
  const relationshipByCompany = new Map<string, { partnerLinkId: string; sharedCapabilities?: SharedBusinessCapability[] }>()
  for (const doc of relationshipsSnap.docs) {
    const row = doc.data() ?? {}
    if (row.deleted === true) continue
    const sourceOrgId = clean(row.sourceOrgId)
    const sourceCompanyId = clean(row.sourceCompanyId)
    if (!sourceOrgId || !sourceCompanyId) continue
    const key = `${sourceOrgId}:${sourceCompanyId}`
    const prev = relationshipByCompany.get(key)
    // Prefer rows that already carry a partnerLinkId.
    if (prev && prev.partnerLinkId && !clean(row.partnerLinkId)) continue
    relationshipByCompany.set(key, {
      partnerLinkId: clean(row.partnerLinkId),
      sharedCapabilities: Array.isArray(row.sharedCapabilities)
        ? (row.sharedCapabilities as SharedBusinessCapability[])
        : undefined,
    })
  }

  const linkedCompanies: LinkedCompanyMigrationRow[] = []
  let skippedDeleted = 0
  let skippedSelfLink = 0
  for (const doc of companiesSnap.docs) {
    const row = doc.data() ?? {}
    if (row.deleted === true) { skippedDeleted += 1; continue }
    const orgId = clean(row.orgId)
    const linkedOrgId = clean(row.linkedOrgId)
    if (!orgId || !linkedOrgId) continue
    if (orgId === linkedOrgId) { skippedSelfLink += 1; continue }
    const rel = relationshipByCompany.get(`${orgId}:${doc.id}`)
    // PiB (serving org) → client: legacy CRM-era capability lists predate the
    // company workspace and omit the marketing modules. The product default is
    // "PiB's work on the client is shared with the client", so union with the
    // workspace defaults. Client → PiB and partner ↔ partner honour the row.
    const sharedCapabilities = orgId === platformOrgId
      ? [...new Set([...(rel?.sharedCapabilities ?? []), ...DEFAULT_MODULES])]
      : rel?.sharedCapabilities
    linkedCompanies.push({
      companyId: doc.id,
      orgId,
      linkedOrgId,
      partnerLinkId: clean(row.partnerLinkId) || rel?.partnerLinkId || undefined,
      sharedCapabilities,
    })
  }

  return {
    snapshot: {
      relationships: [],
      shares: [],
      existingLinks,
      existingGrants,
      existingIdentityLinks: [],
      existingAgreements: [],
      resources: [],
      crmIdentityRows: [],
      linkedCompanies,
    },
    stats: {
      linkedCompanies: linkedCompanies.length,
      activePartnerLinks: existingLinks.length,
      existingCompanyWorkspaceGrants: existingGrants.length,
      relationshipRows: relationshipsSnap.size,
      skippedDeleted,
      skippedSelfLink,
    },
  }
}

const PIP_REF = { kind: 'agent', id: 'pip', label: 'Pip (backfill-company-workspace-grants)' }

async function writePartnerLink(db: FirebaseFirestore.Firestore, op: MigrationOperation) {
  if (!op.documentId || !op.after) return
  const after = op.after as Record<string, unknown>
  const partnerLinkId = op.documentId
  const orgA = clean(after.orgA)
  const orgB = clean(after.orgB)
  const now = admin.firestore.FieldValue.serverTimestamp()
  const scopeId = (grantor: string, grantee: string) => `${partnerLinkId}:${grantor}:${grantee}`
  const scopePayload = (grantorOrgId: string, granteeOrgId: string) => ({
    partnerLinkId,
    direction: { grantorOrgId, granteeOrgId },
    capabilities: after.negotiableCapabilities ?? [],
    fieldSharingPolicy: {
      companyProfile: true, contacts: true, projects: true, documents: true,
      commerce: false, analytics: true, research: true, properties: false,
    },
    status: 'active',
    version: 1,
    schemaVersion: SCHEMA_VERSION,
    proposedByRef: PIP_REF,
    acceptedByRef: PIP_REF,
    acceptance: { grantor: { byRef: PIP_REF, at: now }, grantee: { byRef: PIP_REF, at: now } },
    effectiveAt: now,
    createdAt: now,
    updatedAt: now,
  })

  const batch = db.batch()
  batch.set(db.collection(PARTNER_LINKS).doc(partnerLinkId), {
    partnerLinkId,
    orgA,
    orgB,
    negotiableCapabilities: after.negotiableCapabilities ?? [],
    status: 'active',
    schemaVersion: SCHEMA_VERSION,
    provenance: { source: 'backfill-company-workspace-grants' },
    createdAt: now,
    updatedAt: now,
  }, { merge: true })
  batch.set(db.collection('partnerScopeAgreements').doc(scopeId(orgA, orgB)), scopePayload(orgA, orgB), { merge: true })
  batch.set(db.collection('partnerScopeAgreements').doc(scopeId(orgB, orgA)), scopePayload(orgB, orgA), { merge: true })
  for (const companyId of [clean(after.companyIdA), clean(after.companyIdB)]) {
    if (!companyId) continue
    batch.set(db.collection('companies').doc(companyId), { partnerLinkId, updatedAt: now }, { merge: true })
  }
  await batch.commit()
}

async function writeGrant(db: FirebaseFirestore.Firestore, op: MigrationOperation) {
  if (op.kind === 'promote_partner_link') return writePartnerLink(db, op)
  if (op.kind !== 'backfill_company_workspace_grant' || !op.documentId || !op.after) return
  const after = op.after as Record<string, unknown>
  const partnerLinkId = clean(after.partnerLinkId)
  const ownerOrgId = clean(after.ownerOrgId)
  const grantee = (after.grantee as { orgIds?: string[] } | undefined)?.orgIds?.[0] ?? ''
  const now = admin.firestore.FieldValue.serverTimestamp()
  await db.collection(GRANTS).doc(op.documentId).set({
    ...after,
    scopeAgreementId: `${partnerLinkId}:${ownerOrgId}:${grantee}`,
    role: 'viewer',
    provenance: { source: 'backfill-company-workspace-grants' },
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  }, { merge: true })
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  if (flags.help) {
    process.stdout.write([
      'backfill-company-workspace-grants.ts',
      '  --dry-run (default)   plan only; write evidence; no mutations',
      '  --commit              create missing company_workspace grants (non-destructive)',
      '  --out-dir <path>      evidence output directory',
      '',
    ].join('\n'))
    return
  }

  loadEnvLocal()
  const db = initAdmin()
  const { snapshot, stats } = await hydrateSnapshot(db)
  const plan = buildCanonicalMigrationPlan(snapshot, { mode: flags.mode })

  const written: string[] = []
  const result = await applyMigrationPlan(plan, {
    mode: flags.mode,
    write: async (op) => {
      if (op.destructive) throw new Error(`refusing destructive op ${op.id}`)
      await writeGrant(db, op)
      written.push(op.documentId ?? op.id)
    },
  })

  mkdirSync(flags.outDir, { recursive: true })
  const planPath = resolve(flags.outDir, `${plan.runId}.plan.json`)
  const evidencePath = resolve(flags.outDir, `${plan.runId}.evidence.json`)
  writeFileSync(planPath, JSON.stringify({ snapshotStats: stats, plan }, null, 2))
  writeFileSync(evidencePath, JSON.stringify(result.evidence, null, 2))

  const grantOps = plan.operations.filter((op) => op.kind === 'backfill_company_workspace_grant')
  const byDecision = grantOps.reduce<Record<string, number>>((acc, op) => {
    acc[op.decision] = (acc[op.decision] ?? 0) + 1
    return acc
  }, {})

  const linkOps = plan.operations.filter((op) => op.kind === 'promote_partner_link' && op.decision === 'plan')
  const report = {
    mode: flags.mode,
    destructive: false,
    snapshotStats: stats,
    companyWorkspaceOps: byDecision,
    plannedPartnerLinks: linkOps.map((op) => ({
      partnerLinkId: op.documentId,
      orgA: (op.after as Record<string, unknown> | null)?.orgA,
      orgB: (op.after as Record<string, unknown> | null)?.orgB,
    })),
    planned: grantOps.filter((op) => op.decision === 'plan').map((op) => ({
      grantId: op.documentId,
      ownerOrgId: (op.after as Record<string, unknown> | null)?.ownerOrgId,
      companyId: (op.after as Record<string, unknown> | null)?.resourceId,
      grantee: ((op.after as Record<string, unknown> | null)?.grantee as { orgIds?: string[] } | undefined)?.orgIds,
      items: (op.after as Record<string, unknown> | null)?.items,
    })),
    skipped: grantOps.filter((op) => op.decision === 'skip').map((op) => ({ id: op.id, reason: op.reason })),
    written,
    paths: { planPath, evidencePath },
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
