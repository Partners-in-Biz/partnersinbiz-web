/**
 * GET/POST /api/v1/orgs/[orgId]/integrations — manage GitHub/Slack/Linear webhook secrets.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { clientCanAccessOrg } from '@/lib/llm-providers/org-guard'
import { canManageOrgAs } from '@/lib/orgMembers/permissions'
import { ensureOrgIntegration } from '@/lib/routines/integrations'
import { listOrgIntegrations } from '@/lib/routines/store'
import type { OrgIntegrationProvider } from '@/lib/routines/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ orgId: string }> }

export const GET = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { orgId } = await (ctx as Ctx).params
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  const integrations = await listOrgIntegrations(orgId)
  return apiSuccess({
    integrations: integrations.map((row) => ({
      provider: row.provider,
      enabled: row.enabled,
      webhookPath: row.webhookPath,
      createdAtMs: row.createdAtMs,
      configured: Boolean(row.secretCiphertext || row.secretHash),
    })),
  })
})

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { orgId } = await (ctx as Ctx).params
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (!(await canManageOrgAs(user, orgId, 'admin'))) return apiError('Forbidden', 403)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return apiError('Malformed JSON body', 400)
  const provider = body.provider
  if (provider !== 'github' && provider !== 'slack' && provider !== 'linear') {
    return apiError('provider must be github|slack|linear', 400)
  }

  try {
    const result = await ensureOrgIntegration({
      orgId,
      provider: provider as OrgIntegrationProvider,
      secret: typeof body.secret === 'string' ? body.secret : undefined,
      enabled: body.enabled !== false,
    })
    return apiSuccess({
      integration: {
        provider: result.integration.provider,
        enabled: result.integration.enabled,
        webhookPath: result.integration.webhookPath,
        configured: true,
      },
      ...(result.plaintextSecret ? { plaintextSecret: result.plaintextSecret } : {}),
    }, 201)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : String(err), 400)
  }
})
