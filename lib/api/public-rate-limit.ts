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
