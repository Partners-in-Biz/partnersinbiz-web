import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  createCreativeCanvasTemplate,
  listCreativeCanvasTemplates,
} from '@/lib/creative-canvas/store'
import type { CreativeCanvasActor } from '@/lib/creative-canvas/types'

export const dynamic = 'force-dynamic'

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

function actorFromUser(user: ApiUser): CreativeCanvasActor {
  return {
    uid: user.uid,
    type: user.role === 'ai' ? 'agent' : 'user',
  }
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  const templates = await listCreativeCanvasTemplates(orgId)
  return apiSuccess({ templates })
})

/** Only public https endpoints may be imported — never internal hosts. */
function isSafeImportUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false
  // Block IP-literal hosts outright (public template feeds use hostnames).
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return false
  return true
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return apiError('Malformed JSON body', 400)

  // Import mode: fetch a template definition from a third-party URL and save
  // it as an org template. Expected JSON: { title|name, description?,
  // category?, nodes: [], edges: [] }.
  if (typeof body.importUrl === 'string' && body.importUrl) {
    if (!isSafeImportUrl(body.importUrl)) return apiError('importUrl must be a public https URL', 400)
    let remote: Record<string, unknown>
    try {
      const response = await fetch(body.importUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      })
      if (!response.ok) return apiError(`Template source responded ${response.status}`, 422)
      const raw = await response.text()
      if (raw.length > 2_000_000) return apiError('Template source exceeds 2MB', 422)
      remote = JSON.parse(raw) as Record<string, unknown>
    } catch (err) {
      return apiError(err instanceof Error ? `Template import failed: ${err.message}` : 'Template import failed', 422)
    }
    const title = typeof remote.title === 'string' && remote.title ? remote.title
      : typeof remote.name === 'string' && remote.name ? remote.name : ''
    if (!title) return apiError('Template source is missing a title/name', 422)
    if (!Array.isArray(remote.nodes) || !remote.nodes.length) return apiError('Template source has no nodes', 422)
    const template = await createCreativeCanvasTemplate({
      title,
      description: typeof remote.description === 'string' ? remote.description : `Imported from ${new URL(body.importUrl).hostname}`,
      category: typeof remote.category === 'string' && remote.category ? remote.category : 'imported',
      nodes: remote.nodes,
      edges: Array.isArray(remote.edges) ? remote.edges : [],
    }, orgId, actorFromUser(user))
    return apiSuccess({ template }, 201)
  }

  const template = await createCreativeCanvasTemplate(body, orgId, actorFromUser(user))
  return apiSuccess({ template }, 201)
})
