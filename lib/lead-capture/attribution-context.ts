import type { CaptureAttributionContext } from '@/lib/lead-capture/schema'
import { normalizeCaptureProvenance } from '@/lib/email-marketing/capture-attribution'

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const
const CLICK_KEYS = ['gclid', 'fbclid', 'msclkid', 'ttclid'] as const

export function buildCaptureAttributionContext(input: {
  requestUrl: string
  refererHeader: string
  body?: Record<string, unknown>
  source: Record<string, unknown> & { id: string; name?: string; type?: string }
}) {
  const search = new URL(input.requestUrl).searchParams
  const body = input.body ?? {}
  const observed: Record<string, string> = {
    referrer: input.refererHeader,
    landingPage: typeof body.landingPage === 'string' ? body.landingPage : input.refererHeader,
  }
  for (const key of UTM_KEYS) {
    const bodyValue = typeof body[key] === 'string' ? body[key].trim() : ''
    observed[key] = bodyValue || search.get(key) || ''
  }
  // Click ids are accepted only from the landing URL/query, never from JSON.
  for (const key of CLICK_KEYS) observed[key] = search.get(key) || ''

  const trusted: Record<string, string> = {
    campaignId: typeof input.source.campaignId === 'string' ? input.source.campaignId : '',
    programId: typeof input.source.programId === 'string' ? input.source.programId : '',
  }
  const provenance = normalizeCaptureProvenance({
    sourceId: input.source.id,
    sourceName: input.source.name,
    sourceType: input.source.type,
    campaignId: trusted.campaignId,
    programId: trusted.programId,
    referrer: observed.referrer,
    landingPage: observed.landingPage,
    ...observed,
  })
  const context: CaptureAttributionContext = { observed, trusted }
  return {
    context,
    provenance,
    lineage: {
      trusted: {
        sourceId: provenance.sourceId,
        sourceName: provenance.sourceName,
        sourceType: provenance.sourceType,
        campaignId: provenance.campaignId,
        programId: provenance.programId,
      },
      observed: {
        referrer: provenance.referrer,
        landingPage: provenance.landingPage,
        utm: provenance.utm,
        clickIds: provenance.clickIds,
      },
    },
  }
}
