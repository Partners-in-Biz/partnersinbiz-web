import type { CommunicationProvider, ProviderReadiness, ProviderSendResult } from './types'

export const metaDmCommunicationProvider: CommunicationProvider = {
  id: 'meta',
  name: 'Meta Messenger and Instagram DMs',
  supports: ['messenger', 'instagram'],
  getReadiness(): ProviderReadiness {
    return {
      configured: false,
      healthy: false,
      missing: ['META_APP_ID', 'META_APP_SECRET', 'Meta page/channel permissions'],
      checks: [
        {
          id: 'meta-provider-readiness',
          label: 'Meta DM provider',
          status: 'warn',
          detail: 'Messenger and Instagram are modelled in schema and UI, but disabled until provider readiness is confirmed.',
        },
      ],
    }
  },
  async send(): Promise<ProviderSendResult> {
    return {
      ok: false,
      status: 'unsupported',
      error: 'Meta DM outbound sending is disabled in V1.',
    }
  },
}
