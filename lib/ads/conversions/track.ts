// lib/ads/conversions/track.ts
import { adminDb } from '@/lib/firebase/admin'
import type { AdConversionAction } from '@/lib/ads/types'
import type { ConversionEventInput, ConversionFanoutResult } from './types'

const DEDUPE_COLLECTION = 'ad_conversion_events'

/** Cross-platform conversion fanout.
 *  Looks up the conversion action → determines platform → dispatches to Meta CAPI
 *  OR Google Enhanced Conversions. Idempotent via eventId-as-doc-id dedupe. */
export async function trackConversion(input: ConversionEventInput): Promise<ConversionFanoutResult> {
  // 1. Dedupe — Firestore doc id = eventId
  const dedupeRef = adminDb.collection(DEDUPE_COLLECTION).doc(input.eventId)
  const existing = await dedupeRef.get()
  if (existing.exists) {
    const prior = existing.data() as ConversionFanoutResult & { firstSeenAt?: unknown }
    const dedupeResult: ConversionFanoutResult = {}
    if (prior.meta !== undefined) {
      dedupeResult.meta = prior.meta === 'sent' ? 'sent' : prior.meta === 'failed' ? 'failed' : 'skipped'
    }
    if (prior.google !== undefined) {
      dedupeResult.google = prior.google === 'sent' ? 'sent' : prior.google === 'failed' ? 'failed' : 'skipped'
    }
    if (prior.linkedin !== undefined) {
      dedupeResult.linkedin = prior.linkedin === 'sent' ? 'sent' : prior.linkedin === 'failed' ? 'failed' : 'skipped'
    }
    if (prior.tiktok !== undefined) {
      dedupeResult.tiktok = prior.tiktok === 'sent' ? 'sent' : prior.tiktok === 'failed' ? 'failed' : 'skipped'
    }
    return dedupeResult
  }

  // 2. Look up canonical Conversion Action
  const actionSnap = await adminDb.collection('ad_conversion_actions').doc(input.conversionActionId).get()
  if (!actionSnap.exists) {
    throw new Error(`Conversion Action not found: ${input.conversionActionId}`)
  }
  const action = actionSnap.data() as AdConversionAction
  if (action.orgId !== input.orgId) {
    throw new Error('Conversion Action belongs to a different org')
  }

  const result: ConversionFanoutResult = {}

  // 3. Meta branch
  if (action.platform === 'meta') {
    try {
      // Dynamic import keeps this file independent of the CAPI module's dependency graph.
      // lib/ads/capi/track.ts exports: trackConversion({ orgId, input: CapiEventInput })
      // Translate ConversionEventInput → the CapiEventInput shape expected by that function.
      const capiModule = await import('@/lib/ads/capi/track')
      const capiInput = {
        event_id: input.eventId,
        event_name: action.providerData?.meta?.customEventType ?? 'Purchase',
        event_time: Math.floor(input.eventTime.getTime() / 1000),
        user: {
          email: input.user.email,
          phone: input.user.phone,
          firstName: input.user.firstName,
          lastName: input.user.lastName,
          country: input.user.countryCode,
          zip: input.user.postalCode,
        },
        custom_data: {
          value: input.value,
          currency: input.currency,
          ...(input.customData ?? {}),
        },
        action_source: 'website' as const,
      }
      await capiModule.trackConversion({ orgId: input.orgId, input: capiInput })
      result.meta = 'sent'
    } catch (err) {
      result.meta = 'failed'
      result.metaError = (err as Error).message
      console.error('[trackConversion] Meta fanout failed:', err)
    }
  }

  // 4. Google branch
  if (action.platform === 'google') {
    try {
      const googleResource = action.providerData?.google?.conversionActionResourceName
      if (!googleResource) {
        throw new Error('Google conversion action missing providerData.google.conversionActionResourceName')
      }

      // Resolve Google Ads connection and credentials
      const { getConnection, decryptAccessToken } = await import('@/lib/ads/connections/store')
      const conn = await getConnection({ orgId: input.orgId, platform: 'google' })
      if (!conn) throw new Error('No Google Ads connection for org')

      // decryptAccessToken is synchronous
      const accessToken = decryptAccessToken(conn)

      const { readDeveloperToken } = await import('@/lib/integrations/google_ads/oauth')
      const developerToken = readDeveloperToken()
      if (!developerToken) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN not configured')

      // loginCustomerId stored in conn.meta.google.loginCustomerId or conn.meta.loginCustomerId
      const connMeta = (conn.meta ?? {}) as Record<string, unknown>
      const loginCustomerId =
        typeof connMeta.loginCustomerId === 'string' ? connMeta.loginCustomerId : undefined

      // customerId is the Google Ads customer ID — stored on the connection's defaultAdAccountId
      // or we fall back to the loginCustomerId (manager account)
      const rawCustomerId = conn.defaultAdAccountId ?? loginCustomerId
      if (!rawCustomerId) throw new Error('No Customer ID set on Google connection')
      // Strip 'act_' prefix or dashes if present
      const customerId = rawCustomerId.replace(/^act_/, '').replace(/-/g, '')

      const { uploadEnhancedConversions } = await import('@/lib/ads/providers/google/conversions')

      // Format event time per Google spec: 'YYYY-MM-DD HH:MM:SS+HH:MM'
      const iso = input.eventTime.toISOString() // 'YYYY-MM-DDTHH:MM:SS.sssZ'
      const conversionDateTime = iso.replace('T', ' ').replace(/\.\d+Z$/, '+00:00')

      await uploadEnhancedConversions({
        customerId,
        accessToken,
        developerToken,
        loginCustomerId,
        events: [
          {
            conversionActionResourceName: googleResource,
            conversionDateTime,
            conversionValue: input.value,
            currencyCode: input.currency,
            orderId: input.eventId,
            gclid: input.gclid,
            userIdentifiers: [
              {
                email: input.user.email,
                phone: input.user.phone,
                firstName: input.user.firstName,
                lastName: input.user.lastName,
                countryCode: input.user.countryCode,
                postalCode: input.user.postalCode,
              },
            ],
          },
        ],
      })
      result.google = 'sent'
    } catch (err) {
      result.google = 'failed'
      result.googleError = (err as Error).message
      console.error('[trackConversion] Google fanout failed:', err)
    }
  }

  // 5. LinkedIn branch
  if (action.platform === 'linkedin') {
    try {
      const linkedinProviderData = action.providerData?.linkedin
      const conversionIdOrUrn = linkedinProviderData?.conversionUrn ?? linkedinProviderData?.partnerConversionId
      if (!conversionIdOrUrn) {
        throw new Error(
          'LinkedIn conversion action missing providerData.linkedin.{conversionUrn|partnerConversionId}',
        )
      }

      // Resolve pixel config to get the rw_conversions-scoped CAPI token
      const { listPixelConfigs, decryptPlatformCapiToken } = await import('@/lib/ads/pixel-configs/store')
      const pixelConfigs = await listPixelConfigs({ orgId: input.orgId })
      const pixelConfig = pixelConfigs.find((c) => c.linkedin?.capiTokenEnc) ?? pixelConfigs[0]
      if (!pixelConfig?.linkedin?.capiTokenEnc) {
        throw new Error(
          'LinkedIn pixel config missing capiTokenEnc — admin must set the rw_conversions token in the Insight Tag config',
        )
      }

      const capiAccessToken = decryptPlatformCapiToken(pixelConfig, 'linkedin')

      const { trackConversion: linkedinTrackConversion } = await import('@/lib/ads/providers/linkedin/capi')
      await linkedinTrackConversion({
        capiAccessToken,
        testEventCode: pixelConfig.linkedin.testEventCode,
        input: {
          conversionId: conversionIdOrUrn,
          eventTimeMs: input.eventTime.getTime(),
          user: {
            email: input.user.email,
            phone: input.user.phone,
            liFatId: input.liFatId,
          },
          value:
            input.value !== undefined
              ? { amount: input.value, currencyCode: input.currency ?? 'USD' }
              : undefined,
          eventId: input.eventId,
        },
      })
      result.linkedin = 'sent'
    } catch (err) {
      result.linkedin = 'failed'
      result.linkedinError = (err as Error).message
      console.error('[trackConversion] LinkedIn fanout failed:', err)
    }
  }

  // 6. TikTok branch
  if (action.platform === 'tiktok') {
    try {
      const tiktokData = action.providerData?.tiktok as { eventName?: string } | undefined
      const eventName = tiktokData?.eventName
      if (!eventName) {
        throw new Error(
          'TikTok conversion action missing providerData.tiktok.eventName — set the TikTok standard event name on the action',
        )
      }

      const { listPixelConfigs, decryptPlatformCapiToken } = await import('@/lib/ads/pixel-configs/store')
      const configs = await listPixelConfigs({ orgId: input.orgId })
      // Prefer a config that has a TikTok CAPI token; fall back to first config
      const pixelConfig = configs.find((c) => c.tiktok?.capiTokenEnc) ?? configs[0]
      const tiktokPixel = pixelConfig?.tiktok as
        | { pixelId?: string; capiTokenEnc?: unknown; testEventCode?: string }
        | undefined

      if (!tiktokPixel?.pixelId) {
        throw new Error(
          'TikTok pixel config missing pixelCode — admin must set the Pixel ID in the Events API config',
        )
      }
      if (!tiktokPixel.capiTokenEnc) {
        throw new Error(
          'TikTok pixel config missing capiTokenEnc — admin must set the Events API token in the pixel config',
        )
      }

      const capiAccessToken = decryptPlatformCapiToken(pixelConfig, 'tiktok')

      const { trackConversion: tiktokTrackConversion } = await import('@/lib/ads/providers/tiktok/capi')
      await tiktokTrackConversion({
        capiAccessToken,
        testEventCode: tiktokPixel.testEventCode,
        input: {
          pixelCode: tiktokPixel.pixelId,
          eventName,
          eventId: input.eventId,
          eventTimeIso: input.eventTime.toISOString(),
          user: {
            email: input.user.email,
            phone: input.user.phone,
            ttclid: input.ttclid,
            ttp: input.ttp,
            externalId: input.user.externalId,
          },
          value: input.value,
          currency: input.currency,
        },
      })
      result.tiktok = 'sent'
    } catch (err) {
      result.tiktok = 'failed'
      result.tiktokError = (err as Error).message
      console.error('[trackConversion] TikTok fanout failed:', err)
    }
  }

  // 7. Persist dedupe record (best-effort — failure here doesn't reset the fanout)
  try {
    await dedupeRef.set({
      ...result,
      orgId: input.orgId,
      conversionActionId: input.conversionActionId,
      platform: action.platform,
      firstSeenAt: new Date(),
    })
  } catch (err) {
    console.error('[trackConversion] Dedupe persist failed:', err)
  }

  return result
}
