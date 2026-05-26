#!/usr/bin/env tsx
/**
 * Dry-run by default. Creates/updates the Partners in Biz platform-owner CRM
 * mirror for existing client organizations and their active members:
 *
 * - one Company per client organization, linked by linkedOrgId
 * - one Contact per active client org member, linked by linkedUserId
 *
 * Usage:
 *   npx tsx scripts/backfill-platform-owner-crm-relationships.ts
 *   npx tsx scripts/backfill-platform-owner-crm-relationships.ts --commit
 *   npx tsx scripts/backfill-platform-owner-crm-relationships.ts --org-id client-org
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import * as admin from 'firebase-admin'
import {
  ensurePlatformCompanyForOrg,
  resolvePlatformOwnerOrgId,
  syncPlatformContactForOrgMember,
} from '@/lib/platform-owner/relationships'

export interface CliFlags {
  dryRun: boolean
  orgId?: string
}

export interface MemberMirrorSource {
  uid: string
  role?: string
  displayName?: string
  email?: string
}

export interface ExistingPlatformCrmState {
  companyLinkedOrgIds: Set<string>
  companyNames: Set<string>
  companyDomains: Set<string>
  contactLinkedUserIds: Set<string>
  contactEmails: Set<string>
}

export interface RelationshipBackfillRow {
  orgId: string
  orgName: string
  uid: string
  email: string
  companyAction: 'create' | 'update'
  contactAction: 'create' | 'update' | 'skip'
  reason: string
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeComparable(value: unknown): string {
  return cleanString(value).toLowerCase()
}

function normalizeDomain(value: unknown): string {
  return cleanString(value).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

function isSyntheticMember(uid: string): boolean {
  return uid === 'ai-agent' || uid.startsWith('agent:')
}

export function shouldMirrorUserAsClientContact(input: {
  uid: string
  email?: string
  userRole?: string
}): boolean {
  const uid = cleanString(input.uid)
  const email = normalizeComparable(input.email)
  const userRole = normalizeComparable(input.userRole)
  if (!uid || isSyntheticMember(uid)) return false
  if (email.endsWith('@partnersinbiz.online')) return false
  return !['admin', 'super_admin', 'ai', 'platform_admin'].includes(userRole)
}

export function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: true }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--commit') flags.dryRun = false
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--org-id') flags.orgId = argv[++i]
  }
  return flags
}

export function collectMemberSources(
  embeddedMembers: unknown,
  orgMemberDocs: Array<{ id: string; data: Record<string, unknown> }>,
): MemberMirrorSource[] {
  const byUid = new Map<string, MemberMirrorSource>()

  if (Array.isArray(embeddedMembers)) {
    for (const member of embeddedMembers) {
      if (!member || typeof member !== 'object') continue
      const data = member as Record<string, unknown>
      const uid = cleanString(data.userId) || cleanString(data.uid)
      if (!uid || isSyntheticMember(uid)) continue
      byUid.set(uid, {
        uid,
        role: cleanString(data.role),
        displayName: cleanString(data.displayName),
        email: cleanString(data.email),
      })
    }
  }

  for (const doc of orgMemberDocs) {
    const uid = cleanString(doc.data.uid) || cleanString(doc.data.userId) || cleanString(doc.id.split('_').pop())
    if (!uid || isSyntheticMember(uid)) continue
    const firstName = cleanString(doc.data.firstName)
    const lastName = cleanString(doc.data.lastName)
    const displayName = cleanString(doc.data.displayName) || [firstName, lastName].filter(Boolean).join(' ')
    byUid.set(uid, {
      ...byUid.get(uid),
      uid,
      role: cleanString(doc.data.role) || byUid.get(uid)?.role,
      displayName: displayName || byUid.get(uid)?.displayName,
      email: cleanString(doc.data.email) || byUid.get(uid)?.email || '',
    })
  }

  return Array.from(byUid.values()).sort((a, b) => a.uid.localeCompare(b.uid))
}

export function classifyCompanyAction(input: {
  orgId: string
  orgName: string
  domain?: string
  state: ExistingPlatformCrmState
}): 'create' | 'update' {
  const normalizedName = normalizeComparable(input.orgName)
  const normalizedDomain = normalizeDomain(input.domain)
  return input.state.companyLinkedOrgIds.has(input.orgId) ||
    input.state.companyNames.has(normalizedName) ||
    (Boolean(normalizedDomain) && input.state.companyDomains.has(normalizedDomain))
    ? 'update'
    : 'create'
}

export function classifyContactAction(input: {
  uid: string
  email?: string
  state: ExistingPlatformCrmState
}): 'create' | 'update' {
  const email = normalizeComparable(input.email)
  return input.state.contactLinkedUserIds.has(input.uid) ||
    (Boolean(email) && input.state.contactEmails.has(email))
    ? 'update'
    : 'create'
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

function companyNameForOrg(orgId: string, org: Record<string, unknown>): string {
  return cleanString(org.name) || cleanString(org.displayName) || orgId
}

async function loadExistingPlatformCrmState(
  db: FirebaseFirestore.Firestore,
  platformOrgId: string,
): Promise<ExistingPlatformCrmState> {
  const [companiesSnap, contactsSnap] = await Promise.all([
    db.collection('companies').where('orgId', '==', platformOrgId).limit(5000).get(),
    db.collection('contacts').where('orgId', '==', platformOrgId).limit(5000).get(),
  ])

  const state: ExistingPlatformCrmState = {
    companyLinkedOrgIds: new Set(),
    companyNames: new Set(),
    companyDomains: new Set(),
    contactLinkedUserIds: new Set(),
    contactEmails: new Set(),
  }

  for (const doc of companiesSnap.docs) {
    const data = doc.data() ?? {}
    const linkedOrgId = cleanString(data.linkedOrgId)
    const name = normalizeComparable(data.name)
    const domain = normalizeDomain(data.domain)
    if (linkedOrgId) state.companyLinkedOrgIds.add(linkedOrgId)
    if (name) state.companyNames.add(name)
    if (domain) state.companyDomains.add(domain)
  }

  for (const doc of contactsSnap.docs) {
    const data = doc.data() ?? {}
    const linkedUserId = cleanString(data.linkedUserId)
    const email = normalizeComparable(data.email)
    if (linkedUserId) state.contactLinkedUserIds.add(linkedUserId)
    if (email) state.contactEmails.add(email)
  }

  return state
}

async function userDetails(
  db: FirebaseFirestore.Firestore,
  uid: string,
): Promise<Record<string, unknown>> {
  const userDoc = await db.collection('users').doc(uid).get()
  return userDoc.exists ? userDoc.data() ?? {} : {}
}

function writeReport(rows: RelationshipBackfillRow[], dryRun: boolean): string {
  const reportDir = resolve(process.cwd(), 'scripts/crm-backfill-reports')
  mkdirSync(reportDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = resolve(reportDir, `${stamp}-platform-owner-crm-relationships-${dryRun ? 'dryrun' : 'commit'}.csv`)
  const header: Array<keyof RelationshipBackfillRow> = [
    'orgId',
    'orgName',
    'uid',
    'email',
    'companyAction',
    'contactAction',
    'reason',
  ]
  const csv = [header.join(','), ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(','))].join('\n')
  writeFileSync(reportPath, `${csv}\n`)
  return reportPath
}

export async function run(flags: CliFlags): Promise<RelationshipBackfillRow[]> {
  loadEnv()
  const app = initAdmin()
  const db = app.firestore()
  const platformOrgId = await resolvePlatformOwnerOrgId()
  const existingState = await loadExistingPlatformCrmState(db, platformOrgId)

  const orgDocs = flags.orgId
    ? [(await db.collection('organizations').doc(flags.orgId).get())].filter((doc) => doc.exists)
    : (await db.collection('organizations').get()).docs
  const rows: RelationshipBackfillRow[] = []

  for (const orgDoc of orgDocs) {
    const orgId = orgDoc.id
    if (orgId === platformOrgId) continue
    const org = orgDoc.data() ?? {}
    if (org.deleted === true) continue

    const orgName = companyNameForOrg(orgId, org)
    const companyAction = classifyCompanyAction({
      orgId,
      orgName,
      domain: cleanString(org.domain) || cleanString(org.website),
      state: existingState,
    })

    if (!flags.dryRun) {
      await ensurePlatformCompanyForOrg({
        clientOrgId: orgId,
        clientOrg: org,
        platformOrgId,
        lifecycleStage: 'customer',
        source: 'platform_member_backfill',
        tags: ['client-org'],
      })
    }

    const orgMemberSnap = await db.collection('orgMembers').where('orgId', '==', orgId).get()
    const members = collectMemberSources(
      org.members,
      orgMemberSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() ?? {} })),
    )

    if (members.length === 0) {
      rows.push({
        orgId,
        orgName,
        uid: '',
        email: '',
        companyAction,
        contactAction: 'skip',
        reason: 'company only; no active members found',
      })
      continue
    }

    for (const member of members) {
      const user = await userDetails(db, member.uid)
      const email = cleanString(user.email) || cleanString(member.email)
      const displayName = cleanString(user.displayName) || cleanString(member.displayName) || email || member.uid
      if (!shouldMirrorUserAsClientContact({
        uid: member.uid,
        email,
        userRole: cleanString(user.role),
      })) {
        rows.push({
          orgId,
          orgName,
          uid: member.uid,
          email,
          companyAction,
          contactAction: 'skip',
          reason: 'platform/internal member skipped',
        })
        continue
      }
      const contactAction = classifyContactAction({ uid: member.uid, email, state: existingState })

      rows.push({
        orgId,
        orgName,
        uid: member.uid,
        email,
        companyAction,
        contactAction,
        reason: 'active client member',
      })

      if (flags.dryRun) continue
      await syncPlatformContactForOrgMember({
        clientOrgId: orgId,
        uid: member.uid,
        email,
        displayName,
        role: member.role,
        clientOrg: org,
        platformOrgId,
        companyLifecycleStage: 'customer',
        companySource: 'platform_member_backfill',
        companyTags: ['client-org'],
        contactType: 'client',
        contactStage: 'won',
        contactTags: ['client-member'],
      })
    }
  }

  const reportPath = writeReport(rows, flags.dryRun)
  const companiesToCreate = new Set(rows.filter((row) => row.companyAction === 'create').map((row) => row.orgId)).size
  const contactsToCreate = rows.filter((row) => row.contactAction === 'create').length
  console.log(`Mode: ${flags.dryRun ? 'DRY-RUN (no writes)' : 'COMMITTED'}`)
  console.log(`Platform org: ${platformOrgId}`)
  console.log(`Orgs scanned: ${new Set(rows.map((row) => row.orgId)).size}`)
  console.log(`Companies to create: ${companiesToCreate}`)
  console.log(`Contacts to create: ${contactsToCreate}`)
  console.log(`Rows: ${rows.length}`)
  console.log(`Report: ${reportPath}`)
  return rows
}

if (require.main === module) {
  run(parseFlags(process.argv.slice(2))).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
