import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { clientCanAccessOrg } from '@/lib/llm-providers/org-guard'
import { getOauthSession, updateOauthSession } from '@/lib/llm-providers/oauth/sessions'
import { pollXaiDeviceToken } from '@/lib/llm-providers/oauth/xai'
import { pollCodexDeviceToken } from '@/lib/llm-providers/oauth/codex'
import { upsertLlmProviderConnection } from '@/lib/llm-providers/store'
import { syncLlmConnectionToHermes } from '@/lib/llm-providers/sync-hermes'
import { publicOauthSession } from '@/lib/llm-providers/types'

export const dynamic = 'force-dynamic'

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

type Ctx = { params: Promise<{ sessionId: string }> }

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, ctx) => {
  const { sessionId } = await (ctx as Ctx).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const session = await getOauthSession(sessionId)
  if (!session) return apiError('OAuth session not found', 404)
  if (session.ownerUid !== user.uid) return apiError('Forbidden', 403)
  if (session.orgId !== orgId) return apiError('Forbidden', 403)

  if (session.status === 'completed') {
    return apiSuccess({ session: publicOauthSession(session), connectionId: session.id })
  }
  if (session.status === 'failed' || session.status === 'expired') {
    return apiSuccess({ session: publicOauthSession(session) })
  }
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await updateOauthSession(sessionId, { status: 'expired', error: 'OAuth session expired' })
    return apiSuccess({ session: publicOauthSession({ ...session, status: 'expired', error: 'OAuth session expired' }) })
  }

  try {
    if (session.provider === 'xai-oauth') {
      const result = await pollXaiDeviceToken({
        tokenEndpoint: session.tokenEndpoint,
        deviceCode: session.deviceCode,
      })
      if (result.status === 'pending') {
        return apiSuccess({ session: publicOauthSession(session), pending: true })
      }
      if (result.status === 'slow_down') {
        await updateOauthSession(sessionId, { intervalSeconds: Math.min(session.intervalSeconds + 1, 30) })
        return apiSuccess({ session: publicOauthSession(session), pending: true, slowDown: true })
      }
      if (result.status === 'failed') {
        await updateOauthSession(sessionId, { status: 'failed', error: result.error })
        return apiSuccess({
          session: publicOauthSession({ ...session, status: 'failed', error: result.error }),
        })
      }

      const connection = await upsertLlmProviderConnection({
        provider: 'xai-oauth',
        scope: session.scope,
        orgId: session.orgId,
        ownerUid: session.scope === 'user' ? session.ownerUid : null,
        label: session.label,
        authKind: 'oauth_token',
        credentials: {
          access_token: result.tokens.access_token,
          refresh_token: result.tokens.refresh_token,
          ...(result.tokens.expires_in ? { expires_in: String(result.tokens.expires_in) } : {}),
          ...(result.tokens.token_type ? { token_type: result.tokens.token_type } : {}),
          ...(result.tokens.scope ? { scope: result.tokens.scope } : {}),
          obtained_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + (Number(result.tokens.expires_in) || 21_600) * 1000).toISOString(),
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
    }

    if (session.provider === 'openai-codex') {
      const result = await pollCodexDeviceToken({
        deviceAuthId: session.deviceCode,
        userCode: session.userCode,
      })
      if (result.status === 'pending') {
        return apiSuccess({ session: publicOauthSession(session), pending: true })
      }
      if (result.status === 'failed') {
        await updateOauthSession(sessionId, { status: 'failed', error: result.error })
        return apiSuccess({
          session: publicOauthSession({ ...session, status: 'failed', error: result.error }),
        })
      }

      const connection = await upsertLlmProviderConnection({
        provider: 'openai-codex',
        scope: session.scope,
        orgId: session.orgId,
        ownerUid: session.scope === 'user' ? session.ownerUid : null,
        label: session.label,
        authKind: 'oauth_token',
        credentials: {
          access_token: result.tokens.access_token,
          refresh_token: result.tokens.refresh_token,
          ...(result.tokens.expires_in ? { expires_in: String(result.tokens.expires_in) } : {}),
          ...(result.tokens.token_type ? { token_type: result.tokens.token_type } : {}),
          ...(result.tokens.id_token ? { id_token: result.tokens.id_token } : {}),
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
    }

    return apiError('Unsupported OAuth provider for poll', 400)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'OAuth poll failed', 502)
  }
})
