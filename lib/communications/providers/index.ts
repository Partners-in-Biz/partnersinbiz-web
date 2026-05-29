import { emailCommunicationProvider } from './email'
import { inAppCommunicationProvider } from './in-app'
import { metaDmCommunicationProvider } from './meta'
import { twilioCommunicationProvider } from './twilio'
import type { CommunicationProvider } from './types'
import type { CommunicationChannel, CommunicationProviderId } from '../types'

export const communicationProviders: CommunicationProvider[] = [
  twilioCommunicationProvider,
  emailCommunicationProvider,
  inAppCommunicationProvider,
  metaDmCommunicationProvider,
]

export function getCommunicationProviderForChannel(channel: CommunicationChannel): CommunicationProvider | null {
  return communicationProviders.find((provider) => provider.supports.includes(channel)) ?? null
}

export function getCommunicationProvider(id: CommunicationProviderId): CommunicationProvider | null {
  return communicationProviders.find((provider) => provider.id === id) ?? null
}
