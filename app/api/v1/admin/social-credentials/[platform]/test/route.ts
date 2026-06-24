/**
 * POST /api/v1/admin/social-credentials/[platform]/test
 *
 * Tests the configured OAuth handshake for a platform variant WITHOUT moving
 * any money or persisting a token. It:
 *   1. Confirms env client credentials are present.
 *   2. Builds the real authorization URL the platform would redirect to.
 *   3. Issues a lightweight reachability probe against the provider's token
 *      endpoint host (HEAD/GET) so the operator can see whether the provider is
 *      reachable and the config is well-formed.
 *
 * The result is recorded as a non-fatal handshake check; a `social_credential.test`
 * audit entry is written. Auth: admin.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { writeAdminAudit } from '@/lib/admin/audit'
import { findVariant, resolveVariantOAuth } from '../../_shared'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ platform: string }> }

/** Probe a host for reachability without sending secrets. Never throws. */
async function probeHost(rawUrl: string): Promise<{ reachable: boolean; status: number | null; detail: string }> {
  let origin: string
  try {
    origin = new URL(rawUrl).origin
  } catch {
    return { reachable: false, status: null, detail: 'Invalid token URL in OAuth config' }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(origin, { method: 'GET', redirect: 'manual', signal: controller.signal })
    // Any HTTP response (even 4xx) means the provider host is reachable.
    return { reachable: true, status: res.status, detail: `Provider host responded (${res.status})` }
  } catch (err) {
    return {
      reachable: false,
      status: null,
      detail: err instanceof Error && err.name === 'AbortError' ? 'Timed out after 6s' : 'Host unreachable',
    }
  } finally {
    clearTimeout(timeout)
  }
}

export const POST = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { platform } = await (ctx as RouteContext).params
  const variant = findVariant(platform)
  if (!variant) return apiError('Unknown platform variant', 400)

  const { config, creds, callbackUrl } = resolveVariantOAuth(variant)

  const checks: Array<{ name: string; ok: boolean; detail: string }> = []

  const hasClientId = Boolean(creds?.clientId)
  const hasClientSecret = Boolean(creds?.clientSecret)
  checks.push({ name: 'Client ID present', ok: hasClientId, detail: hasClientId ? 'Found in environment' : 'Missing env var' })
  checks.push({ name: 'Client secret present', ok: hasClientSecret, detail: hasClientSecret ? 'Found in environment' : 'Missing env var' })

  const hasConfig = Boolean(config)
  checks.push({
    name: 'OAuth config resolved',
    ok: hasConfig,
    detail: hasConfig ? `${config!.scopes.length} scopes, callback ${callbackUrl}` : 'No OAuth config (app-password platform?)',
  })

  // Build the authorization URL exactly as the live flow would, when possible.
  let authorizeUrl: string | null = null
  if (config && creds) {
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: config.scopes.join(config.platform === 'reddit' ? ' ' : ' '),
      state: 'handshake-test',
      ...(config.extraAuthParams ?? {}),
    })
    authorizeUrl = `${config.authUrl}?${params.toString()}`
    checks.push({ name: 'Authorization URL built', ok: true, detail: 'Redirect URL constructed successfully' })
  }

  // Reachability probe of the token endpoint host.
  let probe = { reachable: false, status: null as number | null, detail: 'Skipped (no token URL)' }
  if (config?.tokenUrl) {
    probe = await probeHost(config.tokenUrl)
    checks.push({ name: 'Provider reachable', ok: probe.reachable, detail: probe.detail })
  }

  const ok = checks.every((c) => c.ok)

  await writeAdminAudit(user, {
    action: 'social_credential.test',
    summary: `OAuth handshake test for ${variant.label}: ${ok ? 'passed' : 'failed'}`,
    metadata: { key: variant.key, ok, checks: checks.map((c) => ({ name: c.name, ok: c.ok })) },
  })

  return apiSuccess({
    key: variant.key,
    label: variant.label,
    ok,
    checks,
    authorizeUrl,
    providerStatus: probe.status,
    testedAt: new Date().toISOString(),
  })
})
