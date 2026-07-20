import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getLlmProvider } from '@/lib/llm-providers/providers'
import { clientCanAccessOrg, canWriteOrgLlmConnection } from '@/lib/llm-providers/org-guard'
import { createOauthSession } from '@/lib/llm-providers/oauth/sessions'
import { startXaiDeviceCode } from '@/lib/llm-providers/oauth/xai'
import { startCodexDeviceCode } from '@/lib/llm-providers/oauth/codex'

export const dynamic = 'force-dynamic'

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (user.role === 'ai') return apiError('Agents cannot start OAuth flows', 403)

  const body = await req.json().catch(() => null)
  if (!body) return apiError('Malformed JSON body', 400)
  const { provider, scope = 'org', label } = body as {
    provider?: string
    scope?: string
    label?: string
  }

  const def = provider ? getLlmProvider(provider) : null
  if (!def || !def.oauthCapable) {
    return apiError('Provider does not support OAuth from Partners in Biz', 400)
  }
  if (scope !== 'org' && scope !== 'user') return apiError('scope must be "org" or "user"', 400)
  if (scope === 'org' && !(await canWriteOrgLlmConnection(user, orgId))) {
    return apiError('Only organisation admins can connect shared organisation VPS credentials.', 403)
  }

  try {
    if (def.key === 'xai-oauth') {
      const started = await startXaiDeviceCode()
      const session = await createOauthSession({
        provider: def.key,
        hermesProvider: def.hermesProvider,
        orgId,
        ownerUid: user.uid,
        scope,
        label: typeof label === 'string' && label.trim() ? label : def.label,
        deviceCode: started.deviceCode,
        userCode: started.userCode,
        verificationUri: started.verificationUri,
        verificationUriComplete: started.verificationUriComplete,
        tokenEndpoint: started.tokenEndpoint,
        expiresIn: started.expiresIn,
        intervalSeconds: started.intervalSeconds,
      })
      return apiSuccess({ session }, 201)
    }

    if (def.key === 'openai-codex') {
      const started = await startCodexDeviceCode()
      const session = await createOauthSession({
        provider: def.key,
        hermesProvider: def.hermesProvider,
        orgId,
        ownerUid: user.uid,
        scope,
        label: typeof label === 'string' && label.trim() ? label : def.label,
        deviceCode: started.deviceAuthId,
        userCode: started.userCode,
        verificationUri: started.verificationUri,
        verificationUriComplete: null,
        tokenEndpoint: 'codex',
        expiresIn: started.expiresIn,
        intervalSeconds: started.intervalSeconds,
      })
      return apiSuccess({ session }, 201)
    }

    return apiError(
      `${def.label} OAuth must be completed on the Hermes host for now (hermes auth add ${def.hermesProvider}). xAI Grok and OpenAI Codex are available in this UI.`,
      400,
    )
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to start OAuth', 502)
  }
})
