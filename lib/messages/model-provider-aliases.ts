/** Normalize Hermes / PiB provider ids that refer to the same credential family. */

const PROVIDER_ALIAS_GROUPS: string[][] = [
  ['openai-codex', 'openai', 'codex', 'chatgpt'],
  ['openai-api', 'openai-compatible'],
  ['anthropic', 'claude'],
  ['gemini', 'google', 'google-gemini', 'google-ai'],
  ['xai', 'xai-oauth', 'grok'],
  ['deepseek', 'deep-seek'],
  ['openrouter', 'open-router'],
  ['nous', 'nous-portal', 'nousresearch'],
  ['copilot', 'github-copilot', 'github_copilot'],
]

const ALIAS_LOOKUP = new Map<string, Set<string>>()

for (const group of PROVIDER_ALIAS_GROUPS) {
  const set = new Set(group)
  for (const id of group) ALIAS_LOOKUP.set(id, set)
}

export function normalizeProviderId(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

export function providerAliasSet(provider: string | null | undefined): Set<string> {
  const normalized = normalizeProviderId(provider)
  if (!normalized) return new Set()
  return new Set(ALIAS_LOOKUP.get(normalized) ?? [normalized])
}

export function providersShareCredentialFamily(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const leftSet = providerAliasSet(left)
  if (!leftSet.size) return false
  for (const alias of providerAliasSet(right)) {
    if (leftSet.has(alias)) return true
  }
  return false
}

export function expandProviderAliases(providers: Iterable<string>): Set<string> {
  const expanded = new Set<string>()
  for (const provider of providers) {
    for (const alias of providerAliasSet(provider)) expanded.add(alias)
  }
  return expanded
}
