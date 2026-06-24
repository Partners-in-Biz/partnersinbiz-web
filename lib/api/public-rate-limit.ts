import { createHash } from 'crypto'
import type { NextRequest } from 'next/server'
import { apiError } from '@/lib/api/response'
import { checkAndIncrementRateLimit } from '@/lib/rateLimit'

type HeaderRequest = Pick<NextRequest, 'headers'>

export function publicRequestIp(req: HeaderRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || req.headers.get('x-real-ip') || 'unknown'
}

export function publicRateLimitHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

export async function enforcePublicRateLimit(
  req: HeaderRequest,
  input: {
    key: string
    limit: number
    windowMs: number
    message?: string
    // When true, a limiter failure denies the request (fail-closed) instead of
    // allowing it. Use this for unauthenticated write paths where an attacker
    // could otherwise bypass throttling by inducing limiter errors.
    failClosed?: boolean
  },
) {
  let limit
  try {
    limit = await checkAndIncrementRateLimit({
      key: input.key,
      limit: input.limit,
      windowMs: input.windowMs,
    })
  } catch (error) {
    if (input.failClosed) {
      console.error('[public-rate-limit] limiter unavailable; denying request (fail-closed)', error)
      return apiError(input.message ?? 'Service temporarily unavailable. Try again later.', 503)
    }
    console.warn('[public-rate-limit] limiter unavailable; allowing request', error)
    return null
  }

  if (!limit.allowed) {
    return apiError(input.message ?? 'Too many requests. Try again later.', 429, {
      resetAt: limit.resetAt.toISOString(),
    })
  }

  return null
}
