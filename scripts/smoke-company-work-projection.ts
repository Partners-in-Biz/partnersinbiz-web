#!/usr/bin/env tsx
/**
 * Smoke: company-work projection for a linked client that has stamped SEO work.
 * Read-only. Uses equality-only queries (no composite index required).
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as admin from 'firebase-admin'
import { listLinkedCompaniesForViewer, listSharedRecords } from '../lib/company-work/projection'
import { isClientPrivate } from '../lib/work-scope'

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
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID!.trim(),
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!.trim(),
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, '\n').trim(),
    }),
  })
}

async function main() {
  loadEnvLocal()
  initAdmin()
  const db = admin.firestore()

  const grantsSnap = await db.collection('partnerResourceGrants')
    .where('resourceType', '==', 'company_workspace')
    .where('status', '==', 'active')
    .limit(5000)
    .get()

  const candidates = grantsSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() as Record<string, unknown> }))
    .filter((grant) => {
      const items = Array.isArray(grant.items) ? grant.items.map(String) : []
      const viewer = (grant.grantee as { orgIds?: string[] } | undefined)?.orgIds?.[0]
      return grant.ownerOrgId === 'pib-platform-owner'
        && items.includes('seo')
        && Boolean(viewer)
        && Boolean(grant.resourceId)
    })

  let picked: { viewer: string; companyId: string; grantId: string; raw: number; private: number } | null = null
  for (const grant of candidates.slice(0, 40)) {
    const companyId = String(grant.resourceId)
    const viewer = ((grant.grantee as { orgIds?: string[] }).orgIds ?? [])[0]
    const rawSnap = await db.collection('seo_sprints')
      .where('orgId', '==', 'pib-platform-owner')
      .where('companyId', '==', companyId)
      .limit(20)
      .get()
    if (rawSnap.empty) continue
    const rawRows = rawSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    picked = {
      viewer,
      companyId,
      grantId: grant.id,
      raw: rawRows.length,
      private: rawRows.filter((row) => isClientPrivate(row)).length,
    }
    break
  }

  const gundemy = await listLinkedCompaniesForViewer('yBpHhZOU4fAntJYAFOd6')

  if (!picked) {
    console.log(JSON.stringify({
      gundemyLinked: gundemy,
      candidatesChecked: Math.min(candidates.length, 40),
      error: 'no linked company with stamped seo_sprints yet',
    }, null, 2))
    return
  }

  const linked = await listLinkedCompaniesForViewer(picked.viewer)
  const seo = await listSharedRecords(picked.viewer, 'seo', { companyId: picked.companyId, limit: 20 })
  const projects = await listSharedRecords(picked.viewer, 'projects', { companyId: picked.companyId, limit: 20 })
  const documents = await listSharedRecords(picked.viewer, 'documents', { companyId: picked.companyId, limit: 20 })

  console.log(JSON.stringify({
    gundemyLinked: gundemy.map((row) => ({ companyId: row.companyId, modules: row.modules.length })),
    picked,
    linkedCompanyCount: linked.length,
    linkedNames: linked.map((row) => row.companyName),
    projected: { seo: seo.length, projects: projects.length, documents: documents.length },
    seoPrivateFilter: {
      raw: picked.raw,
      private: picked.private,
      sharedRaw: picked.raw - picked.private,
      sharedProjected: seo.length,
    },
    sampleSeo: seo.slice(0, 3).map((row) => ({
      id: row.id,
      title: row.fields.title ?? row.fields.name,
      clientVisibility: row.fields.clientVisibility ?? null,
    })),
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
