type InstagramTokenSuccess = {
  access_token: string
  token_type?: string
  expires_in: number
}

type InstagramTokenError = {
  error?: {
    message?: string
    type?: string
    code?: number
    fbtrace_id?: string
  }
}

type ExchangeAttempt =
  | { ok: true; accessToken: string; expiresIn: number }
  | { ok: false; message: string; methodTypeError: boolean }

export type InstagramLongLivedTokenResult = {
  accessToken: string
  expiresIn: number | null
  exchanged: boolean
}

function normalizeInstagramError(method: 'GET' | 'POST', status: number, body: unknown): string {
  if (
    body &&
    typeof body === 'object' &&
    'error' in body &&
    body.error &&
    typeof body.error === 'object' &&
    'message' in body.error
  ) {
    const err = body as InstagramTokenError
    return err.error?.message || `HTTP ${status}`
  }
  if (typeof body === 'string' && body.trim()) return body
  return `Instagram ${method} long-lived token exchange failed with HTTP ${status}`
}

function isMethodTypeError(message: string, method: 'GET' | 'POST'): boolean {
  return message.toLowerCase().includes(`method type: ${method.toLowerCase()}`)
}

async function readInstagramBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function attemptInstagramLongLivedExchange(
  method: 'GET' | 'POST',
  shortLivedToken: string,
  clientSecret: string,
): Promise<ExchangeAttempt> {
  const params = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: clientSecret,
    access_token: shortLivedToken,
  })

  const res = method === 'GET'
    ? await fetch(`https://graph.instagram.com/access_token?${params.toString()}`)
    : await fetch('https://graph.instagram.com/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })

  const body = await readInstagramBody(res)
  if (res.ok && body && typeof body === 'object' && 'access_token' in body) {
    const data = body as InstagramTokenSuccess
    return { ok: true, accessToken: data.access_token, expiresIn: data.expires_in }
  }

  const message = normalizeInstagramError(method, res.status, body)
  return { ok: false, message, methodTypeError: isMethodTypeError(message, method) }
}

export async function exchangeInstagramLongLivedToken(
  shortLivedToken: string,
  clientSecret: string,
): Promise<InstagramLongLivedTokenResult> {
  const getAttempt = await attemptInstagramLongLivedExchange('GET', shortLivedToken, clientSecret)
  if (getAttempt.ok) return { accessToken: getAttempt.accessToken, expiresIn: getAttempt.expiresIn, exchanged: true }

  if (getAttempt.methodTypeError) {
    const postAttempt = await attemptInstagramLongLivedExchange('POST', shortLivedToken, clientSecret)
    if (postAttempt.ok) return { accessToken: postAttempt.accessToken, expiresIn: postAttempt.expiresIn, exchanged: true }
    if (postAttempt.methodTypeError) {
      return { accessToken: shortLivedToken, expiresIn: null, exchanged: false }
    }
    throw new Error(
      `Instagram long-lived token exchange failed: GET failed (${getAttempt.message}); POST fallback failed (${postAttempt.message})`,
    )
  }

  throw new Error(`Instagram long-lived token exchange failed: ${getAttempt.message}`)
}
