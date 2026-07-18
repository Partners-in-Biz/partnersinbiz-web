import type { LinkedDevicePlatform } from './types'

export const HERMES_PROFILE_PRESETS = [
  { id: 'pip', label: 'Pip', description: 'General business orchestrator' },
  { id: 'sales', label: 'Sales', description: 'CRM and pipeline work' },
  { id: 'support', label: 'Support', description: 'Client support and follow-up' },
  { id: 'marketing', label: 'Marketing', description: 'Content and campaign work' },
  { id: 'data', label: 'Data', description: 'Reporting and analysis' },
] as const

export const HERMES_MODEL_PROVIDERS = [
  { id: 'nous', label: 'Nous Portal', description: 'Sign in without pasting an API key' },
  { id: 'openai', label: 'OpenAI', description: 'Use your own OpenAI API key' },
  { id: 'anthropic', label: 'Anthropic', description: 'Use your own Anthropic API key' },
  { id: 'openrouter', label: 'OpenRouter', description: 'Use one key across many models' },
  { id: 'google', label: 'Google Gemini', description: 'Use your own Gemini API key' },
  { id: 'xai', label: 'xAI', description: 'Use your own xAI API key' },
] as const

const PROFILE_ID = /^[a-z][a-z0-9-]{0,31}$/
const PROVIDER_IDS = new Set(HERMES_MODEL_PROVIDERS.map((provider) => provider.id))

export function linkedComputerBootstrapReady(
  platform: LinkedDevicePlatform,
  configuredPlatforms = process.env.NEXT_PUBLIC_LINKED_RUNTIME_BOOTSTRAP_PLATFORMS ?? '',
): boolean {
  return configuredPlatforms
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .includes(platform)
}

export function sanitizeHermesProfiles(values: unknown): string[] {
  if (!Array.isArray(values)) return ['pip']
  const profiles = Array.from(new Set(values
    .map((value) => typeof value === 'string' ? value.trim().toLowerCase() : '')
    .filter((value) => PROFILE_ID.test(value))))
    .slice(0, 8)
  return profiles.length ? profiles : ['pip']
}

export function sanitizeHermesProviders(values: unknown): string[] {
  if (!Array.isArray(values)) return ['nous']
  const providers = Array.from(new Set(values
    .map((value) => typeof value === 'string' ? value.trim().toLowerCase() : '')
    .filter((value) => PROVIDER_IDS.has(value as typeof HERMES_MODEL_PROVIDERS[number]['id']))))
    .slice(0, 6)
  return providers.length ? providers : ['nous']
}

export function linkedComputerBootstrapCommand(input: {
  platform: LinkedDevicePlatform
  challengeId: string
  profiles: string[]
  providers: string[]
  apiBase?: string
}): string {
  const challengeId = input.challengeId.trim()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(challengeId)) throw new Error('invalid challenge identifier')
  const profiles = sanitizeHermesProfiles(input.profiles).join(',')
  const providers = sanitizeHermesProviders(input.providers).join(',')
  const apiBase = (input.apiBase ?? 'https://partnersinbiz.online').replace(/\/$/, '')
  if (input.platform === 'windows') {
    return `& ([scriptblock]::Create((irm ${apiBase}/runtime/bootstrap/windows.ps1))) -ChallengeId '${challengeId}' -Profiles '${profiles}' -Providers '${providers}'`
  }
  const platform = input.platform === 'linux' ? 'linux' : 'macos'
  return `curl -fsSL ${apiBase}/runtime/bootstrap/${platform}.sh | bash -s -- --challenge '${challengeId}' --profiles '${profiles}' --providers '${providers}'`
}
