#!/usr/bin/env tsx
/**
 * Move client-document holder org to the correct PiB workspace.
 *
 * Model: documents live under the holder (usually pib-platform-owner) and
 * target the client via linked.companyId / linked.clientOrgId.
 *
 * Also stamps agent ids and ensures platform account managers stay on sharedWith
 * for commercial docs when safe.
 *
 *   npx tsx scripts/backfill-document-holder-org.ts
 *   npx tsx scripts/backfill-document-holder-org.ts --commit
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import admin from 'firebase-admin'
import { PIB_PLATFORM_ORG_ID } from '../lib/platform/constants'

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}

function initAdmin() {
  if (admin.apps.length) return admin
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim()
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim()
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n').trim()
  admin.initializeApp({
    credential: admin.credential.cert({ projectId: projectId!, clientEmail: clientEmail!, privateKey: privateKey! }),
  })
  return admin
}

function isHumanUid(uid: string): boolean {
  return Boolean(uid)
    && !uid.startsWith('agent:')
    && uid !== 'ai-agent'
    && uid !== 'saaiman-agent'
    && !uid.startsWith('system:')
}

async function main() {
  const commit = process.argv.includes('--commit')
  loadEnv()
  initAdmin()
  const db = admin.firestore()

  const companiesSnap = await db.collection('companies').where('orgId', '==', PIB_PLATFORM_ORG_ID).get()
  const platformCompanies = new Map<string, { id: string; linkedOrgId?: string; accountManagerUid?: string; allowedUserIds?: string[] }>()
  const clientOrgToCompany = new Map<string, string>()
  for (const doc of companiesSnap.docs) {
    const x = doc.data()
    if (x.deleted === true) continue
    const row = {
      id: doc.id,
      linkedOrgId: typeof x.linkedOrgId === 'string' ? x.linkedOrgId : undefined,
      accountManagerUid: typeof x.accountManagerUid === 'string' ? x.accountManagerUid : undefined,
      allowedUserIds: Array.isArray(x.allowedUserIds) ? x.allowedUserIds.filter((v: unknown) => typeof v === 'string') : [],
    }
    platformCompanies.set(doc.id, row)
    if (row.linkedOrgId) clientOrgToCompany.set(row.linkedOrgId, doc.id)
  }

  const docsSnap = await db.collection('client_documents').get()
  const reports: Array<Record<string, string>> = []
  let written = 0

  for (const doc of docsSnap.docs) {
    const x = doc.data()
    if (x.deleted === true) continue
    const orgId = typeof x.orgId === 'string' ? x.orgId : ''
    const linked = (x.linked && typeof x.linked === 'object' && !Array.isArray(x.linked))
      ? x.linked as Record<string, unknown>
      : {}
    const companyId = typeof linked.companyId === 'string' ? linked.companyId.trim() : ''
    const clientOrgId = typeof linked.clientOrgId === 'string' ? linked.clientOrgId.trim() : ''
    const companyIds = Array.isArray(linked.companyIds)
      ? linked.companyIds.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : []

    const platformCompanyId =
      (companyId && platformCompanies.has(companyId) ? companyId : '')
      || companyIds.find((id) => platformCompanies.has(id))
      || (clientOrgId && clientOrgToCompany.get(clientOrgId))
      || ''

    const patch: Record<string, unknown> = {}
    const reasons: string[] = []

    // Move holder to platform when document is for a platform CRM company but lives on client org.
    if (platformCompanyId && orgId && orgId !== PIB_PLATFORM_ORG_ID) {
      patch.orgId = PIB_PLATFORM_ORG_ID
      reasons.push(`holder ${orgId}→${PIB_PLATFORM_ORG_ID}`)
      const company = platformCompanies.get(platformCompanyId)!
      const nextLinked = { ...linked }
      if (!nextLinked.companyId) nextLinked.companyId = platformCompanyId
      const nextCompanyIds = new Set([
        ...(Array.isArray(nextLinked.companyIds) ? nextLinked.companyIds as string[] : []),
        platformCompanyId,
      ].filter(Boolean))
      nextLinked.companyIds = Array.from(nextCompanyIds)
      if (company.linkedOrgId && !nextLinked.clientOrgId) {
        nextLinked.clientOrgId = company.linkedOrgId
      }
      patch.linked = nextLinked
      reasons.push('relink company/clientOrg')
    }

    // Ensure companyId set when we only have platform company via clientOrg map
    if (platformCompanyId && orgId === PIB_PLATFORM_ORG_ID) {
      const nextLinked = { ...(patch.linked as Record<string, unknown> | undefined) || linked }
      let changed = false
      if (!nextLinked.companyId) {
        nextLinked.companyId = platformCompanyId
        changed = true
      }
      const company = platformCompanies.get(platformCompanyId)
      if (company?.linkedOrgId && !nextLinked.clientOrgId) {
        nextLinked.clientOrgId = company.linkedOrgId
        changed = true
      }
      if (changed) {
        patch.linked = nextLinked
        reasons.push('fill company/clientOrg links')
      }
    }

    // Agent attribution
    const createdBy = typeof x.createdBy === 'string' ? x.createdBy : ''
    if (!x.createdByAgentId) {
      if (createdBy.startsWith('agent:')) {
        patch.createdByAgentId = createdBy.slice('agent:'.length)
        reasons.push('stamp createdByAgentId')
      } else if (createdBy === 'ai-agent' || createdBy === 'saaiman-agent') {
        patch.createdByAgentId = createdBy === 'saaiman-agent' ? 'saaiman' : 'pip'
        reasons.push('stamp legacy agent id')
      }
    }

    // Share with platform company account managers / allowed users (holder team visibility aid)
    if (platformCompanyId) {
      const company = platformCompanies.get(platformCompanyId)!
      const share = new Set<string>(
        Array.isArray(x.sharedWithUserIds)
          ? x.sharedWithUserIds.filter((v: unknown): v is string => typeof v === 'string')
          : [],
      )
      const before = share.size
      if (company.accountManagerUid && isHumanUid(company.accountManagerUid)) {
        share.add(company.accountManagerUid)
      }
      for (const uid of company.allowedUserIds ?? []) {
        if (isHumanUid(uid)) share.add(uid)
      }
      // Keep human creators on share list
      if (isHumanUid(createdBy)) share.add(createdBy)
      if (share.size > before) {
        patch.sharedWithUserIds = Array.from(share)
        reasons.push('share with company AM/allowed')
      }
    }

    if (!reasons.length) continue

    reports.push({
      id: doc.id,
      title: String(x.title || '').slice(0, 80),
      status: String(x.status || ''),
      beforeOrgId: orgId,
      afterOrgId: String(patch.orgId || orgId),
      createdBy,
      reasons: reasons.join('; '),
    })

    if (commit) {
      patch.holderBackfilledAt = admin.firestore.FieldValue.serverTimestamp()
      await doc.ref.update(patch)
      written += 1
    }
  }

  const outDir = resolve(process.cwd(), 'scripts/backfill-reports')
  mkdirSync(outDir, { recursive: true })
  const csvPath = resolve(outDir, `document-holder-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`)
  const header = 'id,title,status,beforeOrgId,afterOrgId,createdBy,reasons'
  const lines = [header, ...reports.map((r) =>
    [r.id, r.title, r.status, r.beforeOrgId, r.afterOrgId, r.createdBy, r.reasons]
      .map((v) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
      .join(','))]
  writeFileSync(csvPath, lines.join('\n'))

  console.log(`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`)
  console.log(`Candidates: ${reports.length}`)
  console.log(`Written: ${written}`)
  console.log(`Report: ${csvPath}`)
  for (const r of reports.slice(0, 30)) {
    console.log(`  ${r.id}  ${r.beforeOrgId}→${r.afterOrgId}  ${r.status}  ${r.reasons}  ${r.title}`)
  }
  if (!commit) console.log('\nRe-run with --commit to write.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
