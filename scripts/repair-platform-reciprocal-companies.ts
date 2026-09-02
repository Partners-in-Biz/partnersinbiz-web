#!/usr/bin/env tsx
/**
 * Repair one-sided platform→client CRM links that lack a reciprocal
 * "Partners in Biz" supplier company on the client org book.
 *
 * The company_workspace grant planner only mints PartnerLinks for reciprocal
 * pairs (by design). One-sided rows therefore stay skipped until this repair
 * creates the missing supplier company, after which
 * `backfill-company-workspace-grants.ts --commit` can mint the link + grants.
 *
 * Dry-run by default.
 *
 * Usage:
 *   npx tsx scripts/repair-platform-reciprocal-companies.ts
 *   npx tsx scripts/repair-platform-reciprocal-companies.ts --commit
 *   npx tsx scripts/repair-platform-reciprocal-companies.ts --commit --orgId=<clientOrgId>
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as admin from 'firebase-admin'
import {
  ensurePlatformCompanyForOrg,
  ensureReciprocalSupplierCompanyForOrg,
  PLATFORM_OWNER_FALLBACK_ID,
} from '../lib/platform-owner/relationships'

interface Flags {
  commit: boolean
  orgId: string
  help: boolean
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { commit: false, orgId: '', help: false }
  for (const arg of argv) {
    if (arg === '--commit') flags.commit = true
    else if (arg === '--help' || arg === '-h') flags.help = true
    else if (arg.startsWith('--orgId=')) flags.orgId = arg.slice('--orgId='.length).trim()
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

function initAdmin() {
  if (admin.apps.length > 0) return
  const keyPath = resolve(process.cwd(), 'service-account.json')
  if (existsSync(keyPath)) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(keyPath, 'utf8'))) })
    return
  }
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim()
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim()
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n').trim()
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase admin credentials')
  }
  admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) })
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  if (flags.help) {
    console.log(`Usage:
  npx tsx scripts/repair-platform-reciprocal-companies.ts [--commit] [--orgId=<clientOrgId>]`)
    return
  }

  loadEnvLocal()
  initAdmin()
  const db = admin.firestore()

  const companiesSnap = await db.collection('companies').where('linkedOrgId', '!=', '').limit(5000).get()
  const linked = companiesSnap.docs
    .map((doc) => {
      const data = doc.data() ?? {}
      return {
        companyId: doc.id,
        orgId: clean(data.orgId),
        linkedOrgId: clean(data.linkedOrgId),
        name: clean(data.name),
        deleted: data.deleted === true,
      }
    })
    .filter((row) => row.linkedOrgId && !row.deleted && row.orgId !== row.linkedOrgId)

  const pairs = new Set(linked.map((row) => `${row.orgId}>${row.linkedOrgId}`))
  const platformOrgId = PLATFORM_OWNER_FALLBACK_ID
  const oneSided = linked.filter((row) => {
    if (row.orgId !== platformOrgId) return false
    if (!pairs.has(`${row.linkedOrgId}>${row.orgId}`)) return true
    return false
  }).filter((row) => !flags.orgId || row.linkedOrgId === flags.orgId)

  console.log(JSON.stringify({
    mode: flags.commit ? 'commit' : 'dry-run',
    platformOrgId,
    oneSidedCount: oneSided.length,
    oneSided,
  }, null, 2))

  if (!flags.commit) {
    console.log('\nDry-run only. Re-run with --commit to mint reciprocal supplier companies.')
    return
  }

  const results = []
  for (const row of oneSided) {
    const platform = await ensurePlatformCompanyForOrg({
      clientOrgId: row.linkedOrgId,
      platformOrgId,
    })
    const reciprocal = await ensureReciprocalSupplierCompanyForOrg({
      clientOrgId: row.linkedOrgId,
      platformOrgId,
    })
    results.push({ companyName: row.name, platform, reciprocal })
  }

  console.log(JSON.stringify({
    applied: results.length,
    results,
    next: 'npx tsx scripts/backfill-company-workspace-grants.ts --commit',
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
