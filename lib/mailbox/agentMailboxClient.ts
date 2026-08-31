export type AgentMailboxRemintResult = {
  token: string
}

export type AgentMailboxClientAuth = {
  token: string
  orgId: string
  remint: () => Promise<AgentMailboxRemintResult | null>
}

function extractError(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const error = (body as { error?: unknown }).error
  return typeof error === 'string' ? error : ''
}

export function isMailboxDelegationEvidenceFailure(status: number, body: unknown): boolean {
  if (status !== 401 && status !== 403) return false
  if (status === 401) return true
  return /delegation evidence/i.test(extractError(body))
}

function isUserDelegationToken(token: string): boolean {
  return token.startsWith('pib_dlg_')
}

function isForbiddenFallbackToken(token: string): boolean {
  const aiKey = typeof process.env.AI_API_KEY === 'string' ? process.env.AI_API_KEY.trim() : ''
  if (aiKey && token === aiKey) return true
  return token.startsWith('pib_ag_') || token === 'legacy-god-key'
}

/**
 * Call /api/v1/agent/email/* with the current user-delegation token.
 * On 401/403 with delegation-evidence, remint once and retry.
 * Never falls back to AI_API_KEY / pib_ag_ system keys.
 */
export async function callAgentMailbox(input: {
  url: string
  method?: string
  auth: AgentMailboxClientAuth
  headers?: Record<string, string>
  body?: unknown
  fetchImpl?: typeof fetch
}): Promise<Response> {
  const fetchFn = input.fetchImpl ?? fetch
  const send = (token: string) => fetchFn(input.url, {
    method: input.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Org-Id': input.auth.orgId,
      ...(input.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...input.headers,
    },
    ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
  })

  const first = await send(input.auth.token)
  if (!isUserDelegationToken(input.auth.token)) return first
  if (first.status !== 401 && first.status !== 403) return first

  const snapshot = first.clone()
  const body = await snapshot.json().catch(() => ({}))
  if (!isMailboxDelegationEvidenceFailure(first.status, body)) return first

  const reminted = await input.auth.remint()
  const nextToken = reminted?.token?.trim() ?? ''
  if (!nextToken || !isUserDelegationToken(nextToken) || isForbiddenFallbackToken(nextToken)) {
    return first
  }
  return send(nextToken)
}
