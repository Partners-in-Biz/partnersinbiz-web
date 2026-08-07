import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { clientCanAccessOrg } from '@/lib/llm-providers/org-guard'
import { decryptToken } from '@/lib/social/encryption'
import { getOauthSession, updateOauthSession } from '@/lib/llm-providers/oauth/sessions'
import { exchangeAnthropicCode } from '@/lib/llm-providers/oauth/anthropic'
import { upsertLlmProviderConnection } from '@/lib/llm-providers/store'
import { syncLlmConnectionToHermes } from '@/lib/llm-providers/sync-hermes'
import { llmConnectionScopeKey, publicOauthSession } from '@/lib/llm-providers/types'

export const dynamic = 'force-dynamic'

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

type Ctx = { params: Promise<{ sessionId: string }> }

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx) => {
  const { sessionId } = await (ctx as Ctx).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const body = await req.json().catch(() => null)
  const code = body && typeof body.code === 'string' ? body.code.trim() : ''
  if (!code) return apiError('code is required', 400)

  const session = await getOauthSession(sessionId)
  if (!session) return apiError('OAuth session not found', 404)
  if (session.ownerUid !== user.uid) return apiError('Forbidden', 403)
  if (session.orgId !== orgId) return apiError('Forbidden', 403)
  if (session.provider !== 'anthropic') {
    return apiError('Code exchange is only supported for Anthropic OAuth sessions', 400)
  }
  if (session.flow !== 'authorization_code') {
    return apiError('Code exchange is only supported for authorization_code OAuth sessions', 400)
  }
  if (session.status !== 'awaiting_code') {
    return apiError(`OAuth session is ${session.status}`, 400)
  }
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await updateOauthSession(sessionId, { status: 'expired', error: 'OAuth session expired' })
    return apiError('OAuth session expired. Start a new sign-in.', 400)
  }
  // Claude Code derives state from the verifier; when a client forwards state,
  // it must match what the server issued.
  if (typeof body.state === 'string' && body.state && session.state && body.state !== session.state) {
    return apiError('OAuth state mismatch', 400)
  }
  if (!session.verifierEnc || !session.state) {
    return apiError('OAuth session is missing PKCE material', 400)
  }

  let verifier: string
  try {
    verifier = decryptToken(session.verifierEnc, llmConnectionScopeKey(session))
  } catch {
    return apiError('Could not decrypt OAuth session verifier', 500)
  }

  try {
    const tokens = await exchangeAnthropicCode({ code, verifier, state: session.state })
    const connection = await upsertLlmProviderConnection({
      provider: 'anthropic',
      scope: session.scope,
      orgId: session.orgId,
      ownerUid: session.scope === 'user' ? session.ownerUid : null,
      label: session.label,
      authKind: 'oauth_token',
      credentials: {
        access_token: tokens.access_token,
        ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
        ...(tokens.expires_in ? { expires_in: String(tokens.expires_in) } : {}),
        ...(tokens.token_type ? { token_type: tokens.token_type } : {}),
        ...(tokens.scope ? { scope: tokens.scope } : {}),
        obtained_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + (Number(tokens.expires_in) || 21_600) * 1000).toISOString(),
      },
    }, { uid: user.uid, type: 'user' })

    await updateOauthSession(sessionId, { status: 'completed', error: null })
    let sync: Awaited<ReturnType<typeof syncLlmConnectionToHermes>> | undefined
    try {
      sync = await syncLlmConnectionToHermes(connection.id)
    } catch (err) {
      sync = {
        synced: [],
        queued: [],
        failed: [{ agentId: '*', error: err instanceof Error ? err.message : 'Sync failed' }],
      }
    }
    return apiSuccess({
      session: publicOauthSession({ ...session, status: 'completed' }),
      connection,
      sync,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'OAuth code exchange failed', 502)
  }
})
