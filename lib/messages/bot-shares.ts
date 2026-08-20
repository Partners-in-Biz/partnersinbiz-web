/**
 * Shareable custom GrokBots — durable Bot identities beyond the org roster.
 *
 * Platform specialists stay on the org visibility list. Custom linked agents
 * (created in Bot mode or Settings) can be shared privately, with the org, or
 * via a link others can preview and clone onto their own computer/VPS.
 *
 * Marketplace instances stay pull/uninstall-only and are not field-editable
 * or re-shared as GrokBots.
 */

export const BOT_SHARE_VISIBILITIES = ['private', 'organization', 'link'] as const
export type BotShareVisibility = (typeof BOT_SHARE_VISIBILITIES)[number]

export const BOT_SHARE_ID_RE = /^bs_[a-f0-9]{24}$/

export interface BotShareSnapshot {
  name: string
  role: string
  persona: string
  iconKey: string
  colorKey: string
  defaultModel: string
  agentHandle?: string
  agentKind: 'custom'
}

export interface BotShareRecord {
  shareId: string
  sourceOrgId: string
  sourceAgentId: string
  visibility: BotShareVisibility
  allowClone: boolean
  createdByUserId: string
  revokedAt?: string | null
  snapshot: BotShareSnapshot
}

export interface PublicBotSharePreview {
  shareId: string
  visibility: BotShareVisibility
  allowClone: boolean
  name: string
  role: string
  persona: string
  iconKey: string
  colorKey: string
  defaultModel: string
  agentHandle?: string
  agentKind: 'custom'
}

export function isBotShareVisibility(value: unknown): value is BotShareVisibility {
  return value === 'private' || value === 'organization' || value === 'link'
}

export function parseBotShareVisibility(value: unknown): BotShareVisibility {
  return isBotShareVisibility(value) ? value : 'private'
}

export function parseBotShareId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return BOT_SHARE_ID_RE.test(trimmed) ? trimmed : null
}

export function parseBotShareIdFromInput(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const direct = parseBotShareId(trimmed)
  if (direct) return direct
  try {
    const url = new URL(trimmed, 'https://partnersinbiz.local')
    const fromQuery = parseBotShareId(url.searchParams.get('botShare'))
    if (fromQuery) return fromQuery
    const parts = url.pathname.split('/').filter(Boolean)
    const sharesAt = parts.lastIndexOf('shares')
    if (sharesAt >= 0) return parseBotShareId(parts[sharesAt + 1])
  } catch {
    // not a URL
  }
  const match = trimmed.match(/bs_[a-f0-9]{24}/)
  return match ? match[0] : null
}

export function canShareAgentAsGrokBot(agent: {
  agentKind?: string | null
  marketplaceTemplateId?: string | null
  provisioningMode?: string | null
  scopeOrgId?: string | null
} | null | undefined): boolean {
  if (!agent) return false
  if (agent.agentKind === 'marketplace' || agent.marketplaceTemplateId) return false
  if (agent.provisioningMode && agent.provisioningMode !== 'linked_device') return false
  if (agent.agentKind === 'custom') return true
  return Boolean(agent.scopeOrgId && agent.provisioningMode === 'linked_device')
}

export function buildBotShareSnapshot(agent: {
  name?: string | null
  role?: string | null
  persona?: string | null
  iconKey?: string | null
  colorKey?: string | null
  defaultModel?: string | null
  agentHandle?: string | null
}): BotShareSnapshot | null {
  const name = agent.name?.trim() || ''
  const role = agent.role?.trim() || ''
  const persona = agent.persona?.trim() || ''
  if (!name || !role || !persona) return null
  return {
    name: name.slice(0, 100),
    role: role.slice(0, 120),
    persona: persona.slice(0, 20_000),
    iconKey: (agent.iconKey?.trim() || 'smart_toy').slice(0, 48),
    colorKey: (agent.colorKey?.trim() || 'sky').slice(0, 24),
    defaultModel: (agent.defaultModel?.trim() || 'auto').slice(0, 200),
    agentKind: 'custom',
    ...(agent.agentHandle?.trim() ? { agentHandle: agent.agentHandle.trim().slice(0, 20) } : {}),
  }
}

export function publicBotSharePreview(share: Pick<BotShareRecord, 'shareId' | 'visibility' | 'allowClone' | 'snapshot' | 'revokedAt'>): PublicBotSharePreview | null {
  if (share.revokedAt) return null
  const snapshot = share.snapshot
  if (!snapshot?.name || !snapshot.role || !snapshot.persona) return null
  return {
    shareId: share.shareId,
    visibility: share.visibility,
    allowClone: share.allowClone !== false,
    name: snapshot.name,
    role: snapshot.role,
    persona: snapshot.persona,
    iconKey: snapshot.iconKey || 'smart_toy',
    colorKey: snapshot.colorKey || 'sky',
    defaultModel: snapshot.defaultModel || 'auto',
    agentKind: 'custom',
    ...(snapshot.agentHandle ? { agentHandle: snapshot.agentHandle } : {}),
  }
}

export function canViewBotShare(share: Pick<BotShareRecord, 'visibility' | 'sourceOrgId' | 'createdByUserId' | 'revokedAt'>, viewer: {
  uid: string
  orgId?: string | null
}): boolean {
  if (share.revokedAt) return false
  if (share.visibility === 'link') return true
  if (share.createdByUserId === viewer.uid) return true
  if (share.visibility === 'organization') return Boolean(viewer.orgId && viewer.orgId === share.sourceOrgId)
  return false
}

export function canCloneBotShare(share: Pick<BotShareRecord, 'allowClone' | 'visibility' | 'sourceOrgId' | 'createdByUserId' | 'revokedAt'>, viewer: {
  uid: string
  orgId?: string | null
}): boolean {
  if (share.allowClone === false) return false
  return canViewBotShare(share, viewer)
}

const HANDLE_RE = /^[a-z][a-z0-9._-]{1,19}$/

export function sanitizeBotHandle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!trimmed) return null
  const prefixed = /^[a-z]/.test(trimmed) ? trimmed : `b${trimmed}`
  const handle = prefixed.slice(0, 20)
  return HANDLE_RE.test(handle) ? handle : null
}

export function allocateBotHandle(desired: unknown, taken: Iterable<string>, name?: string): string | null {
  const takenSet = new Set(Array.from(taken).map((value) => value.trim().toLowerCase()).filter(Boolean))
  const base = sanitizeBotHandle(desired) || sanitizeBotHandle(typeof name === 'string' ? name.replace(/\s+/g, '-') : '') || 'bot'
  if (!takenSet.has(base)) return base
  for (let index = 2; index < 100; index += 1) {
    const suffix = String(index)
    const candidate = `${base.slice(0, Math.max(1, 20 - suffix.length))}${suffix}`
    if (HANDLE_RE.test(candidate) && !takenSet.has(candidate)) return candidate
  }
  return null
}
