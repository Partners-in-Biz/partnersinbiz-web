import type { CommunicationProvider, ProviderReadiness, ProviderSendResult } from './types'

export const inAppCommunicationProvider: CommunicationProvider = {
  id: 'in_app',
  name: 'PiB in-app notifications',
  supports: ['in_app'],
  getReadiness(): ProviderReadiness {
    return {
      configured: true,
      healthy: true,
      missing: [],
      checks: [
        {
          id: 'in-app-notifications',
          label: 'In-app notification infrastructure',
          status: 'pass',
          detail: 'Uses the existing PiB notification and push infrastructure.',
        },
      ],
    }
  },
  async send(): Promise<ProviderSendResult> {
    return {
      ok: true,
      status: 'queued',
      raw: { note: 'In-app communications are queued through the existing notification pipeline.' },
    }
  },
}
