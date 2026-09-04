import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { listLlmProviders, getLlmProvider, UNSUPPORTED_CURSOR_NOTE } from '@/lib/llm-providers/providers'
import { listLlmProviderConnections, upsertLlmProviderConnection } from '@/lib/llm-providers/store'
import { normalizeLlmShareTargets } from '@/lib/llm-providers/types'
import { validateLlmCredentials } from '@/lib/llm-providers/validate'
import { clientCanAccessOrg, canWriteOrgLlmConnection } from '@/lib/llm-providers/org-guard'
import { syncLlmConnectionToHermes } from '@/lib/llm-providers/sync-hermes'
import { resolveOrgLlmSyncTargets } from '@/lib/llm-providers/sync-targets'
import type { LlmProviderKey } from '@/lib/llm-providers/providers'
import { listConnectionLlmCredentialBindings } from '@/lib/llm-providers/bindings'

export const dynamic = 'force-dynamic'

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  const [connections, syncTargets, canManageOrgConnections] = await Promise.all([
    listLlmProviderConnections({ orgId, uid: user.uid }),
    resolveOrgLlmSyncTargets(orgId),
    canWriteOrgLlmConnection(user, orgId),
  ])
  const bindings = (await Promise.all(connections.map((connection) =>
    listConnectionLlmCredentialBindings(connection.id),
  ))).flat().map((binding) => ({
    id: binding.id,
    connectionId: binding.connectionId,
    credentialVersion: binding.credentialVersion,
    runtimeTargetId: binding.runtimeTargetId,
    deviceId: binding.deviceId,
    machineLabel: binding.machineLabel,
    agentId: binding.agentId,
    status: binding.status,
    liveAuthVerified: binding.liveAuthVerified,
    lastError: binding.lastError,
    lastVerifiedAt: binding.lastVerifiedAt,
  }))
  return apiSuccess({
    providers: listLlmProviders(),
    connections,
    bindings,
    canManageOrgConnections,
    syncTargets: {
      orgVpsDeviceCount: syncTargets.orgVpsDeviceCount,
      hasHermesProfileLink: syncTargets.hasHermesProfileLink,
      targetCount: syncTargets.targets.length,
      reasonIfEmpty: syncTargets.reasonIfEmpty,
    },
    notes: {
      cursor: UNSUPPORTED_CURSOR_NOTE,
      orgScope: 'Organisation credentials sync only to this organisation’s VPS Hermes profiles and are shared by everyone using that VPS.',
      userScope:
        'Personal credentials sync only to computers owned by your account. They are never copied to the shared organisation VPS.',
      hermesNative:
        'Explicit model choices in Messages use only accounts connected here that passed a live check on the selected machine and agent profile. Auto may still use the runtime-managed default.',
    },
  })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const body = await req.json().catch(() => null)
  if (!body) return apiError('Malformed JSON body', 400)

  const { provider, scope, label, credentials, sync = true, agentIds, shareTargets } = body as {
    provider?: string
    scope?: string
    label?: string
    credentials?: Record<string, string>
    sync?: boolean
    agentIds?: string[]
    shareTargets?: unknown
  }

  const providerDef = provider ? getLlmProvider(provider) : null
  if (!providerDef) return apiError('Unknown provider', 400)
  if (scope !== 'org' && scope !== 'user') return apiError('scope must be "org" or "user"', 400)
  if (scope === 'org' && !(await canWriteOrgLlmConnection(user, orgId))) {
    return apiError('Only organisation admins can connect shared organisation VPS credentials.', 403)
  }
  if (scope === 'user' && user.role === 'ai') {
    return apiError('Agents can only create organisation-scoped connections', 400)
  }
  if (providerDef.authKind === 'oauth' && providerDef.credentialFields.length === 0) {
    return apiError('This provider requires OAuth. POST /api/v1/llm-providers/oauth/start instead.', 400)
  }
  if (!credentials || typeof credentials !== 'object') return apiError('credentials are required', 400)

  const allowed = new Set(providerDef.credentialFields.map((f) => f.key))
  const cleaned: Record<string, string> = {}
  for (const [key, value] of Object.entries(credentials)) {
    if (allowed.has(key) && typeof value === 'string' && value.trim()) {
      if (value.trim().length > 8192) return apiError('Credential value too long', 400)
      cleaned[key] = value.trim()
    }
  }
  for (const field of providerDef.credentialFields) {
    if (!field.optional && !cleaned[field.key]) return apiError(`${field.label} is required`, 400)
  }

  const validation = await validateLlmCredentials(providerDef.key as LlmProviderKey, cleaned)
  if (!validation.ok) return apiError(validation.error ?? 'Credential validation failed', 400)

  const connection = await upsertLlmProviderConnection({
    provider: providerDef.key,
    scope,
    orgId,
    ownerUid: scope === 'user' ? user.uid : null,
    label: typeof label === 'string' && label.trim() ? label : providerDef.label,
    credentials: cleaned,
    meta: validation.models ? { discoveredModels: validation.models } : {},
    ...(scope === 'org' ? { shareTargets: normalizeLlmShareTargets(shareTargets) } : {}),
  }, {
    uid: user.role === 'ai' && user.agentId ? `agent:${user.agentId}` : user.uid,
    type: user.role === 'ai' ? 'agent' : 'user',
  })

  let syncResult: Awaited<ReturnType<typeof syncLlmConnectionToHermes>> | undefined
  if (sync !== false) {
    try {
      syncResult = await syncLlmConnectionToHermes(connection.id, {
        agentIds: Array.isArray(agentIds) ? agentIds : undefined,
        accessPolicy: user.memberAccessPolicy,
      })
    } catch (err) {
      syncResult = {
        synced: [],
        queued: [],
        failed: [{ agentId: '*', error: err instanceof Error ? err.message : 'Sync failed' }],
      }
    }
  }

  return apiSuccess({ connection, sync: syncResult }, 201)
})
