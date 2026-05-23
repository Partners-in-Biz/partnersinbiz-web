import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { callAgentPath } from '@/lib/agents/team'
import { adminDb } from '@/lib/firebase/admin'
import { resolveKnowledgeAgent } from '@/lib/knowledge/agents'
import { renderResearchMarkdown, renderResearchSourcesMarkdown } from '@/lib/research/markdown'
import {
  getResearchItem,
  listResearchSources,
  markResearchObsidianExported,
} from '@/lib/research/store'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function orgSlug(orgId: string) {
  const snap = await adminDb.collection('organizations').doc(orgId).get()
  if (!snap.exists) return null
  const slug = snap.data()?.slug
  return typeof slug === 'string' && slug ? slug : null
}

async function saveKnowledgeNote(agent: string, section: 'wiki' | 'raw', path: string, content: string) {
  return callAgentPath('pip', '/admin/knowledge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: 'agent', agent, section, path, content }),
  })
}

export const POST = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const item = await getResearchItem(id)
  if (!item) return apiError('Research item not found', 404)
  const scope = resolveOrgScope(user, item.orgId)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const slug = await orgSlug(item.orgId)
  if (!slug) return apiError('Client slug is required for Obsidian export', 400)

  const agent = resolveKnowledgeAgent(slug) ?? slug
  const sources = await listResearchSources(id)
  const wikiPath = `research/${item.slug}.md`
  const rawPath = `research/${item.slug}-sources.md`

  const wiki = await saveKnowledgeNote(agent, 'wiki', wikiPath, renderResearchMarkdown(item, sources))
  if (!wiki.response.ok) return apiError('Knowledge wiki export failed', wiki.response.status, { upstream: wiki.data })

  const raw = await saveKnowledgeNote(agent, 'raw', rawPath, renderResearchSourcesMarkdown(item, sources))
  if (!raw.response.ok) return apiError('Knowledge raw-source export failed', raw.response.status, { upstream: raw.data })

  await markResearchObsidianExported(id, wikiPath, rawPath, user)
  return apiSuccess({ path: wikiPath, sourcesPath: rawPath })
})
