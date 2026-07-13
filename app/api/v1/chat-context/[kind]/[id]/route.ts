import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isChatContextKind, isOpaqueContextId } from '@/lib/chat-context/access'
import { chatContextRegistry } from '@/lib/chat-context/registry'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ kind: string; id: string }> }

export const GET = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const raw = await (ctx as RouteContext).params
  const kind = raw.kind.trim()
  const id = raw.id.trim()
  if (!isChatContextKind(kind)) return apiError('Unsupported context kind', 400)
  if (!isOpaqueContextId(id)) return apiError('Invalid context id', 400)

  const result = await chatContextRegistry.resolve({ kind, id, user })
  if (!result.ok) {
    if (result.reason === 'forbidden' || result.reason === 'not_found') {
      return apiError('Context unavailable', 404)
    }
    return apiError(result.error, result.status)
  }
  return apiSuccess(result.revision ? { ...result.model, revision: result.revision } : result.model)
})
