// Per-ingest-key rate limiter: 100 requests/minute by default.
// The effective ceiling now resolves through the shared runtime rate-limit
// policy helper so the admin control plane actually affects live enforcement.

import { checkAndIncrementRateLimit } from '@/lib/rateLimit'

const LIMIT = 100
const WINDOW_MS = 60_000

export async function checkIngestRateLimit(ingestKey: string): Promise<boolean> {
  const safeKey = ingestKey.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 64)

  try {
    const result = await checkAndIncrementRateLimit({
      key: `analytics_ingest:${safeKey}`,
      limit: LIMIT,
      windowMs: WINDOW_MS,
      profileId: 'analytics_ingest',
    })
    return result.allowed
  } catch {
    return true // fail open
  }
}
