import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { callAgentPath } from '@/lib/agents/team'
import { resolveKnowledgeAgent, SAFE_KNOWLEDGE_AGENT } from '@/lib/knowledge/agents'
import type { KnowledgeScope, KnowledgeSection } from '@/lib/knowledge/types'

export const dynamic = 'force-dynamic'

const KNOWLEDGE_AGENT = 'pip'

function readScope(searchParams: URLSearchParams): KnowledgeScope | null {
  const scope = searchParams.get('scope')
  return scope === 'shared' || scope === 'agent' ? scope : null
}

function readSection(searchParams: URLSearchParams): KnowledgeSection {
  const section = searchParams.get('section')
  return section === 'index' || section === 'wiki' || section === 'raw' || section === 'logs'
    ? section
    : 'wiki'
}

function appendQuery(path: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  const qs = search.toString()
  return qs ? `${path}?${qs}` : path
}

export const GET = withAuth('admin', async (req: NextRequest) => {
  const scope = readScope(req.nextUrl.searchParams)
  if (!scope) return apiError('scope must be shared or agent', 400)

  const section = readSection(req.nextUrl.searchParams)
  const requestedAgent = req.nextUrl.searchParams.get('agent')?.trim() || undefined
  const agent = resolveKnowledgeAgent(requestedAgent)
  const path = req.nextUrl.searchParams.get('path')?.trim() || undefined
  if (scope === 'agent' && (!agent || !SAFE_KNOWLEDGE_AGENT.test(agent))) {
    return apiError('agent is required for client knowledge', 400)
  }

  try {
    const upstream = await callAgentPath(KNOWLEDGE_AGENT, appendQuery('/admin/knowledge', {
      scope,
      section,
      agent,
      path,
    }))
    if (!upstream.response.ok) {
      const message = upstream.response.status === 404
        ? 'Knowledge note not found'
        : 'Knowledge backend is not available'
      return apiError(message, upstream.response.status, { upstream: upstream.data })
    }
    return apiSuccess({ ...(upstream.data as Record<string, unknown>), requestedAgent })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach knowledge backend', 502)
  }
})

export const POST = withAuth('admin', async (req: NextRequest) => {
  const body = await req.json().catch(() => null) as {
    scope?: KnowledgeScope
    section?: KnowledgeSection
    agent?: string
    path?: string
    content?: string
  } | null
  if (!body) return apiError('Invalid JSON body', 400)
  if (body.scope !== 'shared' && body.scope !== 'agent') return apiError('scope must be shared or agent', 400)
  if (body.section && !['index', 'wiki', 'raw', 'logs'].includes(body.section)) {
    return apiError('section must be index, wiki, raw, or logs', 400)
  }
  if (body.scope === 'agent' && (!body.agent || !SAFE_KNOWLEDGE_AGENT.test(body.agent))) {
    return apiError('agent is required for client knowledge', 400)
  }
  if (!body.path || typeof body.path !== 'string') return apiError('path is required', 400)
  if (typeof body.content !== 'string') return apiError('content is required', 400)

  try {
    const agent = resolveKnowledgeAgent(body.agent)
    const upstream = await callAgentPath(KNOWLEDGE_AGENT, '/admin/knowledge', {
      method: 'POST',
      body: JSON.stringify({ ...body, agent }),
      headers: { 'Content-Type': 'application/json' },
    })
    if (!upstream.response.ok) {
      return apiError('Knowledge save failed', upstream.response.status, { upstream: upstream.data })
    }
    return apiSuccess(upstream.data)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to save knowledge note', 502)
  }
})
