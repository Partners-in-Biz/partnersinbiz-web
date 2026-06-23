import fs from 'fs'
import path from 'path'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import { scanApiRoutes } from './scan'

export const dynamic = 'force-dynamic'

const HTTP_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
const DOCS_COLLECTION = 'admin_api_docs'

interface EndpointDoc {
  description: string
  notes: string
}

function readPackageVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { version?: string }
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.1.0'
  } catch {
    return '0.1.0'
  }
}

/**
 * Load all editable per-endpoint docs from Firestore, keyed by
 * `${method} ${path}`.
 */
async function loadDocMap(): Promise<Map<string, EndpointDoc>> {
  const map = new Map<string, EndpointDoc>()
  const snap = await adminDb.collection(DOCS_COLLECTION).get()
  for (const doc of snap.docs) {
    const data = doc.data() ?? {}
    const key = typeof data.key === 'string' ? data.key : ''
    if (!key) continue
    map.set(key, {
      description: typeof data.description === 'string' ? data.description : '',
      notes: typeof data.notes === 'string' ? data.notes : '',
    })
  }
  return map
}

export const GET = withAuth('admin', async () => {
  const endpoints = scanApiRoutes()
  const docMap = await loadDocMap()

  const merged = endpoints.map((ep) => {
    const key = `${ep.method} ${ep.path}`
    const doc = docMap.get(key)
    return {
      method: ep.method,
      path: ep.path,
      group: ep.group,
      description: doc?.description ?? '',
      notes: doc?.notes ?? '',
    }
  })

  // Group by `group`
  const groupOrder: string[] = []
  const grouped = new Map<string, typeof merged>()
  for (const ep of merged) {
    if (!grouped.has(ep.group)) {
      grouped.set(ep.group, [])
      groupOrder.push(ep.group)
    }
    grouped.get(ep.group)!.push(ep)
  }

  const groups = groupOrder
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((group) => ({ group, endpoints: grouped.get(group)! }))

  return apiSuccess({
    apiVersion: 'v1',
    version: readPackageVersion(),
    totalEndpoints: merged.length,
    groups,
  })
})

export const PATCH = withAuth('admin', async (req, user) => {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      method?: unknown
      path?: unknown
      description?: unknown
      notes?: unknown
    }

    const method = typeof body.method === 'string' ? body.method.toUpperCase() : ''
    const docPath = typeof body.path === 'string' ? body.path : ''

    if (!HTTP_METHODS.has(method)) {
      return apiError('method must be one of GET, POST, PATCH, PUT, DELETE', 400)
    }
    if (!docPath || !docPath.startsWith('/')) {
      return apiError('path must be a non-empty string starting with "/"', 400)
    }

    const description = typeof body.description === 'string' ? body.description : undefined
    const notes = typeof body.notes === 'string' ? body.notes : undefined
    const key = `${method} ${docPath}`

    const existing = await adminDb
      .collection(DOCS_COLLECTION)
      .where('key', '==', key)
      .limit(1)
      .get()

    if (!existing.empty) {
      const ref = existing.docs[0].ref
      const update: Record<string, unknown> = { ...lastActorFrom(user) }
      if (description !== undefined) update.description = description
      if (notes !== undefined) update.notes = notes
      await ref.update(update)
    } else {
      await adminDb.collection(DOCS_COLLECTION).add({
        key,
        method,
        path: docPath,
        description: description ?? '',
        notes: notes ?? '',
        createdAt: FieldValue.serverTimestamp(),
        ...lastActorFrom(user),
      })
    }

    return apiSuccess({
      key,
      description: description ?? '',
      notes: notes ?? '',
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
