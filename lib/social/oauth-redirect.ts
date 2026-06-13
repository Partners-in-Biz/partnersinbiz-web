const DEFAULT_OAUTH_REDIRECT_PATH = '/portal/social'

export function sanitizeOAuthRedirectPath(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_OAUTH_REDIRECT_PATH
  const trimmed = value.trim()
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) return DEFAULT_OAUTH_REDIRECT_PATH

  try {
    const parsed = new URL(trimmed, 'https://partnersinbiz.local')
    if (parsed.origin !== 'https://partnersinbiz.local') return DEFAULT_OAUTH_REDIRECT_PATH
    if (!parsed.pathname.startsWith('/portal/')) return DEFAULT_OAUTH_REDIRECT_PATH
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return DEFAULT_OAUTH_REDIRECT_PATH
  }
}

export function buildOAuthRedirectPath(
  redirectPath: unknown,
  params: Record<string, string | null | undefined>,
): string {
  const safePath = sanitizeOAuthRedirectPath(redirectPath)
  const parsed = new URL(safePath, 'https://partnersinbiz.local')

  Object.entries(params).forEach(([key, value]) => {
    if (typeof value === 'string' && value.trim()) {
      parsed.searchParams.set(key, value)
    }
  })

  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}
