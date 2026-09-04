import crypto from 'node:crypto'

export const MANAGED_PROFILE_MAX = 40
const SLUG_RE = /^[a-z][a-z0-9-]{0,62}$/
const AGENT_RE = /^[a-z][a-z0-9-]{0,39}$/

export function managedProfileName(orgSlug: string, agentId: string): string {
  if (!SLUG_RE.test(orgSlug)) throw new Error(`managed profile: invalid org slug "${orgSlug}"`)
  if (!AGENT_RE.test(agentId)) throw new Error(`managed profile: invalid agent id "${agentId}"`)
  const full = `${orgSlug}--${agentId}`
  if (full.length <= MANAGED_PROFILE_MAX) return full
  const hash = crypto.createHash('sha256').update(orgSlug).digest('hex').slice(0, 6)
  const budget = MANAGED_PROFILE_MAX - agentId.length - 2 - 7
  if (budget < 3) throw new Error(`managed profile: agent id too long for a managed profile "${agentId}"`)
  return `${orgSlug.slice(0, budget).replace(/-+$/, '')}-${hash}--${agentId}`
}

export function parseManagedProfileName(profile: string): { orgSlugPart: string; agentId: string } | null {
  const idx = profile.lastIndexOf('--')
  if (idx <= 0) return null
  return { orgSlugPart: profile.slice(0, idx), agentId: profile.slice(idx + 2) }
}
