import type { ChatContextAdapter } from '@/lib/chat-context/access'
import { listCreativeCanvases } from '@/lib/creative-canvas/store'
import { resolveContextReferences } from '@/lib/context-references/registry'

function allowedOrgId(id: string, user: Parameters<ChatContextAdapter['resolve']>[0]['user']): string | null {
  const prefix = 'marketing_studio:'
  if (!id.startsWith(prefix)) return null
  const requested = id.slice(prefix.length)
  const allowed = new Set([user.activeOrgId, user.orgId, ...(user.orgIds ?? []), ...(user.allowedOrgIds ?? [])].filter(Boolean))
  return user.role === 'admin' && !user.allowedOrgIds?.length ? requested : allowed.has(requested) ? requested : null
}

export const marketingStudioChatContextAdapter: ChatContextAdapter = {
  async resolve({ id, user }) {
    const orgId = allowedOrgId(id, user)
    if (!orgId) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const [reference] = await resolveContextReferences([{ type: 'studio', id, orgId }], user, orgId)
    if (!reference || reference.id !== id || reference.orgId !== orgId) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const allCanvases = await listCreativeCanvases(orgId)
    const canvases = user.role === 'client' ? allCanvases.filter((canvas) => canvas.visibility === 'admin_agents_clients') : allCanvases
    const base = user.role === 'client' ? '/portal/creative-canvas' : '/admin/creative-canvas'
    const overviewHref = `${base}?${new URLSearchParams({ orgId }).toString()}`
    return { ok: true, model: {
      context: { kind: 'studio', id, orgId, label: 'Marketing Studio', icon: 'marketing_studio', href: overviewHref },
      pulse: { label: `${canvases.length} canvas${canvases.length === 1 ? '' : 'es'}`, metrics: [
        { id: 'review', label: 'In review', value: canvases.filter((canvas) => canvas.status === 'internal_review' || canvas.status === 'client_review').length },
        { id: 'approved', label: 'Approved', value: canvases.filter((canvas) => canvas.status === 'approved').length },
      ] },
      groups: canvases.length ? [{ id: 'canvases', label: 'Canvases', items: canvases.map((canvas) => ({
        id: canvas.id, label: canvas.title, state: canvas.status === 'approved' ? 'complete' as const : canvas.status.includes('review') ? 'review' as const : 'ready' as const,
        href: `${base}?${new URLSearchParams({ canvasId: canvas.id, orgId }).toString()}`,
      })) }] : [],
      artifacts: [], attention: [], activity: [], capabilities: ['view'], asOf: new Date().toISOString(),
    } }
  },
}
