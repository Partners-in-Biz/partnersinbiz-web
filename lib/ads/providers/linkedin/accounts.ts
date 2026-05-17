import { LINKEDIN_ADS_API_BASE, LINKEDIN_ADS_VERSION } from './constants'

interface CallArgs {
  accessToken: string
}

export interface LinkedinAdAccount {
  /** Numeric account ID */
  id: string
  /** URN format: 'urn:li:sponsoredAccount:{id}' */
  urn: string
  name?: string
  currency?: string
  type?: string  // BUSINESS, ENTERPRISE
  status?: string  // ACTIVE, DRAFT, CANCELED, PENDING_DELETION, REMOVED
  reference?: string  // owning org URN
}

function buildHeaders(args: CallArgs): Record<string, string> {
  return {
    Authorization: `Bearer ${args.accessToken}`,
    'LinkedIn-Version': LINKEDIN_ADS_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  }
}

/** List LinkedIn ad accounts the authenticated user has access to.
 *  Filters to ACTIVE + DRAFT status via REST.li 2.0 search syntax. */
export async function listAdAccounts(args: CallArgs): Promise<LinkedinAdAccount[]> {
  const search = '(status:(values:List(ACTIVE,DRAFT)))'
  const url = `${LINKEDIN_ADS_API_BASE}/adAccounts?q=search&search=${encodeURIComponent(search)}`

  const res = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(args),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LinkedIn ad accounts listing failed: HTTP ${res.status} — ${text}`)
  }

  const data = (await res.json()) as {
    elements?: Array<{
      id?: number | string
      name?: string
      currency?: string
      type?: string
      status?: string
      reference?: string
    }>
  }

  return (data.elements ?? []).map((acc) => {
    const idStr = String(acc.id ?? '')
    return {
      id: idStr,
      urn: `urn:li:sponsoredAccount:${idStr}`,
      name: acc.name,
      currency: acc.currency,
      type: acc.type,
      status: acc.status,
      reference: acc.reference,
    }
  }).filter((acc) => acc.id.length > 0)
}
