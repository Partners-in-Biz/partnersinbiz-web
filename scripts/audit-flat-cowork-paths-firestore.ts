#!/usr/bin/env tsx
/**
 * Read-only audit: find remaining flat Partners-era Cowork path tokens in Firestore.
 *
 *   npx tsx scripts/audit-flat-cowork-paths-firestore.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as admin from 'firebase-admin'

const COLLECTIONS: Array<{ name: string; limit: number }> = [
  { name: 'org_workspaces', limit: 400 },
  { name: 'organizations', limit: 400 },
  { name: 'conversations', limit: 600 },
  { name: 'workspace_folders', limit: 400 },
  { name: 'projects', limit: 400 },
  { name: 'project_setups', limit: 200 },
  { name: 'linked_device_workspace_mappings', limit: 200 },
]

const FLAT_RE = /(\/var\/lib\/hermes\/Cowork\/(?!partners\/|Cowork\/|Partners in Biz — Client Growth)|~\/Cowork\/(?!partners\/|Cowork\/|Partners in Biz — Client Growth)|\/Users\/[^/]+\/Cowork\/(?!partners\/|Cowork\/|Partners in Biz — Client Growth))/

function loadEnv(): void {
  for (const filename of ['.env.local', '.env']) {
    const envPath = resolve(process.cwd(), filename)
    if (!existsSync(envPath)) continue
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
}

function initAdmin(): void {
  if (admin.apps.length > 0) return
  const keyPath = resolve(process.cwd(), 'service-account.json')
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim()
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim()
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n').trim()
  if (existsSync(keyPath)) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(readFileSync(keyPath, 'utf8')) as admin.ServiceAccount),
    })
  } else if (projectId && clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    })
  } else {
    admin.initializeApp({ credential: admin.credential.applicationDefault() })
  }
}

function scan(value: unknown, path = ''): string[] {
  const hits: string[] = []
  if (typeof value === 'string') {
    if (FLAT_RE.test(value)) hits.push(`${path}=${value}`)
    return hits
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => hits.push(...scan(item, `${path}[${index}]`)))
    return hits
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      hits.push(...scan(child, path ? `${path}.${key}` : key))
    }
  }
  return hits
}

async function main() {
  loadEnv()
  initAdmin()
  const db = admin.firestore()
  let totalHitDocs = 0
  for (const { name, limit } of COLLECTIONS) {
    try {
      const snap = await db.collection(name).limit(limit).get()
      let hitDocs = 0
      const samples: string[] = []
      for (const doc of snap.docs) {
        const hits = scan(doc.data())
        if (!hits.length) continue
        hitDocs += 1
        if (samples.length < 5) samples.push(`${name}/${doc.id}: ${hits.slice(0, 2).join(' | ')}`)
      }
      totalHitDocs += hitDocs
      console.log(JSON.stringify({ collection: name, scanned: snap.size, hitDocs, samples }, null, 2))
    } catch (error) {
      console.log(JSON.stringify({
        collection: name,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2))
    }
  }
  console.log(`Total docs with flat Cowork path tokens: ${totalHitDocs}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
