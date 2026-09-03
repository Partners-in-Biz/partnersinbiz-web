import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { runWithFirestoreReadAudit } from '@/lib/firebase/read-audit'
import {
  flagStaleRevokePending,
  refreshDueAnthropicLlmConnections,
  refreshDueXaiLlmConnections,
  type LlmCredentialRefreshSummary,
} from '@/lib/llm-providers/refresh-worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest): Promise<Response> {
  const authorized = (Boolean(process.env.CRON_SECRET)
    && req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`)
    || Boolean(req.headers.get('x-vercel-cron'))
  if (!authorized) return apiError('Unauthorized', 401)

  try {
    const summary = await runWithFirestoreReadAudit(
      'api/cron/llm-credential-refresh',
      async () => {
        const [xai, anthropic, stale] = await Promise.all([
          refreshDueXaiLlmConnections(),
          refreshDueAnthropicLlmConnections(),
          flagStaleRevokePending().catch(() => ({ flagged: 0 })),
        ])
        const merged: LlmCredentialRefreshSummary = {
          scanned: xai.scanned + anthropic.scanned,
          due: xai.due + anthropic.due,
          refreshed: xai.refreshed + anthropic.refreshed,
          synced: xai.synced + anthropic.synced,
          queued: xai.queued + anthropic.queued,
          failed: xai.failed + anthropic.failed,
        }
        return { ...merged, staleRevokePending: stale.flagged, byProvider: { xai, anthropic } }
      },
    )
    return apiSuccess(summary)
  } catch (error) {
    console.error('[llm-credential-refresh-cron-error]', error)
    return apiError('LLM credential refresh worker failed', 500)
  }
}
