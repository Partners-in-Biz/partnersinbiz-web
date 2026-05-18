// lib/ads/providers/tiktok/accounts.ts
import { TIKTOK_ADS_API_BASE } from './constants'

export interface TiktokAdvertiser {
  advertiserId: string
  advertiserName?: string
  /** ISO 4217 currency code (USD, EUR, etc) — fetched via /advertiser/info if needed */
  currency?: string
  /** Status — STATUS_ENABLE, STATUS_DISABLE, etc */
  status?: string
}

/** List advertiser accounts the OAuth grant gives access to.
 *  Uses /oauth2/advertiser/get/ which requires app_id + secret in the query
 *  (this is a TikTok quirk — the other endpoints take Access-Token only). */
export async function listAdvertisers(args: {
  accessToken: string
  fetchImpl?: typeof fetch
}): Promise<TiktokAdvertiser[]> {
  const appId = process.env.TIKTOK_ADS_CLIENT_ID?.trim()
  const secret = process.env.TIKTOK_ADS_CLIENT_SECRET?.trim()
  if (!appId || !secret) {
    throw new Error('TIKTOK_ADS_CLIENT_ID + TIKTOK_ADS_CLIENT_SECRET required')
  }

  const url = new URL(`${TIKTOK_ADS_API_BASE}/oauth2/advertiser/get/`)
  url.searchParams.set('app_id', appId)
  url.searchParams.set('secret', secret)
  url.searchParams.set('access_token', args.accessToken)

  const fetchImpl = args.fetchImpl ?? fetch
  const res = await fetchImpl(url.toString(), { method: 'GET' })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`TikTok listAdvertisers HTTP ${res.status} — ${text.slice(0, 200)}`)
  }
  const env = (await res.json()) as {
    code: number
    message: string
    data: { list?: Array<{ advertiser_id: string; advertiser_name?: string }> }
  }
  if (env.code !== 0) {
    throw new Error(`TikTok listAdvertisers code=${env.code} message=${env.message}`)
  }

  return (env.data.list ?? []).map((a) => ({
    advertiserId: a.advertiser_id,
    advertiserName: a.advertiser_name,
  }))
}
