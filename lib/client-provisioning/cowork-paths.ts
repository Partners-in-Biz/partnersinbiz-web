/**
 * Org-scoped Cowork folder layout.
 *
 * Canonical shape (Mac + VPS):
 *   ~/Cowork/{nestingOrgSlug}/{folderName}
 *   /var/lib/hermes/Cowork/{nestingOrgSlug}/{folderName}
 *
 * Partners in Biz (platform owner) uses nesting slug `partners`.
 * Other organisations use their own org slug so same company names never share a tree.
 */
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export const VPS_COWORK_ROOT = '/var/lib/hermes/Cowork'
export const LOCAL_COWORK_ROOT = '~/Cowork'
export const VPS_OBSIDIAN_ROOT = `${VPS_COWORK_ROOT}/Cowork`
export const LOCAL_OBSIDIAN_ROOT = `${LOCAL_COWORK_ROOT}/Cowork`

/** Filesystem nesting segment for the Partners platform owner org. */
export const PIB_COWORK_NESTING_SLUG = 'partners'

/** URL/admin slug sometimes used for Partners; always normalize to PIB_COWORK_NESTING_SLUG. */
export const PIB_ORG_URL_SLUG = 'partners-in-biz'

export type CoworkPathScope = {
  /** Display folder name under the org nest (e.g. "Hunt and Gun", "Partners in Biz"). */
  folderName: string
  /** Agent / wiki domain kebab slug (e.g. "hunt-and-gun"). */
  domain: string
  /** Firestore organisation id that owns this workspace. */
  orgId: string
  /** Preferred human nesting slug when orgId is not the platform owner. */
  orgSlug?: string | null
  /**
   * When true, nest under `partners` even if orgId is a linked client org.
   * Used for CRM companies operated from the Partners security perspective.
   */
  platformOwned?: boolean
}

export type CoworkPaths = {
  nestingOrgSlug: string
  folderName: string
  workspaceId: string
  orgSlug: string
  agentDomain: string
  relativeFromCoworkRoot: string
  localPath: string
  vpsPath: string
  localAgentDomainPath: string
  agentDomainPath: string
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Sanitize a nesting / workspace slug: lowercase kebab, no path separators. */
export function sanitizeCoworkNestingSlug(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  if (!slug || slug === '.' || slug === '..' || slug.includes('/') || slug.includes('\\')) {
    throw new Error(`Invalid Cowork nesting slug: ${value}`)
  }
  return slug
}

/**
 * Resolve which org folder segment a workspace nests under.
 * Platform owner always nests under `partners`.
 */
export function resolveCoworkNestingOrgSlug(input: {
  orgId: string
  orgSlug?: string | null
  platformOwned?: boolean
}): string {
  const orgId = clean(input.orgId)
  if (!orgId) throw new Error('orgId is required to resolve Cowork nesting')
  if (orgId === PIB_PLATFORM_ORG_ID || input.platformOwned) return PIB_COWORK_NESTING_SLUG

  const rawSlug = clean(input.orgSlug)
  if (rawSlug === PIB_ORG_URL_SLUG || rawSlug === PIB_COWORK_NESTING_SLUG) {
    return PIB_COWORK_NESTING_SLUG
  }
  if (rawSlug) return sanitizeCoworkNestingSlug(rawSlug)
  return sanitizeCoworkNestingSlug(orgId)
}

/**
 * Workspace document id.
 * Partners-era company/org workspaces keep the historical global domain id
 * (`partners`, `hunt-and-gun`, …). Other orgs are prefixed to prevent collisions.
 */
export function buildCoworkWorkspaceId(nestingOrgSlug: string, domain: string): string {
  const nest = sanitizeCoworkNestingSlug(nestingOrgSlug)
  const cleanDomain = sanitizeCoworkNestingSlug(domain)
  if (nest === PIB_COWORK_NESTING_SLUG) return cleanDomain
  return `${nest}__${cleanDomain}`
}

export function buildCoworkPaths(scope: CoworkPathScope): CoworkPaths {
  const folderName = clean(scope.folderName)
  const domain = sanitizeCoworkNestingSlug(clean(scope.domain) || 'company')
  if (!folderName) throw new Error('Cowork folderName is required')
  if (folderName.includes('/') || folderName.includes('\\') || folderName === '.' || folderName === '..') {
    throw new Error(`Invalid Cowork folderName: ${folderName}`)
  }

  const nestingOrgSlug = resolveCoworkNestingOrgSlug({
    orgId: scope.orgId,
    orgSlug: scope.orgSlug,
    platformOwned: scope.platformOwned,
  })
  const relativeFromCoworkRoot = `${nestingOrgSlug}/${folderName}`
  const workspaceId = buildCoworkWorkspaceId(nestingOrgSlug, domain)

  return {
    nestingOrgSlug,
    folderName,
    workspaceId,
    orgSlug: nestingOrgSlug,
    agentDomain: domain,
    relativeFromCoworkRoot,
    localPath: `${LOCAL_COWORK_ROOT}/${relativeFromCoworkRoot}`,
    vpsPath: `${VPS_COWORK_ROOT}/${relativeFromCoworkRoot}`,
    localAgentDomainPath: `${LOCAL_OBSIDIAN_ROOT}/agents/${domain}`,
    agentDomainPath: `${VPS_OBSIDIAN_ROOT}/agents/${domain}`,
  }
}

export type OperatorWorkspaceTarget = {
  /** Nesting org segment (e.g. `partners`). */
  orgSlug: string
  /** Display folder name / basename (e.g. `Hunt and Gun`). */
  folderName: string
  /** Relative path from the Cowork root (e.g. `partners/Hunt and Gun`). */
  relativeFromCoworkRoot: string
}

/**
 * Resolve an operator CLI `--workspace` value into the org-nested relative path.
 *
 * - `--workspace "Hunt and Gun"` + default/org slug → `partners/Hunt and Gun`
 * - `--workspace "partners/Hunt and Gun"` → already nested; do not double-nest
 */
export function resolveOperatorWorkspaceTarget(input: {
  workspace: string
  orgSlug?: string | null
}): OperatorWorkspaceTarget {
  const trimmed = clean(input.workspace)
  if (!trimmed) throw new Error('Workspace name is required')

  const defaultSlug = sanitizeCoworkNestingSlug(clean(input.orgSlug) || PIB_COWORK_NESTING_SLUG)
  const segments = trimmed.split('/').map((segment) => segment.trim()).filter(Boolean)
  if (segments.length === 0) throw new Error('Workspace name is required')
  for (const segment of segments) {
    if (
      segment === '.'
      || segment === '..'
      || segment.includes('\\')
      || segment.includes('\0')
      || segment.includes('\n')
      || segment.includes('\r')
    ) {
      throw new Error('Workspace path contains unsafe segments')
    }
  }

  if (segments.length >= 2) {
    const folderName = segments[segments.length - 1]
    const orgSlug = sanitizeCoworkNestingSlug(segments[0])
    return {
      orgSlug,
      folderName,
      relativeFromCoworkRoot: segments.join('/'),
    }
  }

  return {
    orgSlug: defaultSlug,
    folderName: segments[0],
    relativeFromCoworkRoot: `${defaultSlug}/${segments[0]}`,
  }
}

/** True when a portable/absolute path still uses the pre-nesting flat layout. */
export function isLegacyFlatCoworkPath(value: string): boolean {
  const trimmed = clean(value)
  if (!trimmed) return false
  const match = trimmed.match(/^(?:~\/Cowork|\/var\/lib\/hermes\/Cowork|\/Users\/[^/]+\/Cowork)\/([^/]+)(?:\/.*)?$/)
  if (!match) return false
  const segment = match[1]
  if (
    segment === 'Cowork'
    || segment === PIB_COWORK_NESTING_SLUG
    || segment === 'Partners in Biz — Client Growth'
    || segment === 'Side Projects'
    || segment === 'YouTube Business'
    || segment.startsWith('.')
  ) {
    return false
  }
  return true
}

/**
 * Rewrite a stored flat Partners-era path into the nested `partners/` layout.
 * Returns the original string when the path is already nested / reserved wiki,
 * and null when the value is not a recognisable Cowork path.
 */
export function rewriteLegacyFlatCoworkPath(
  value: string,
  nestingOrgSlug: string = PIB_COWORK_NESTING_SLUG,
): string | null {
  const trimmed = clean(value)
  if (!trimmed) return null
  const nest = sanitizeCoworkNestingSlug(nestingOrgSlug)

  const isCoworkPath = (
    trimmed === '~/Cowork'
    || trimmed.startsWith('~/Cowork/')
    || trimmed === VPS_COWORK_ROOT
    || trimmed.startsWith(`${VPS_COWORK_ROOT}/`)
    || /^\/Users\/[^/]+\/Cowork(?:\/|$)/.test(trimmed)
  )
  if (!isCoworkPath) return null
  if (!isLegacyFlatCoworkPath(trimmed)) return trimmed

  const rewrite = (prefix: string, rest: string): string => {
    const segments = rest.split('/').filter(Boolean)
    if (segments.length === 0) return `${prefix}/${nest}`
    if (segments[0] === nest || segments[0] === 'Cowork') return trimmed
    return `${prefix}/${nest}/${segments.join('/')}`
  }

  if (trimmed === '~/Cowork' || trimmed.startsWith('~/Cowork/')) {
    return rewrite('~/Cowork', trimmed.slice('~/Cowork'.length))
  }
  if (trimmed === VPS_COWORK_ROOT || trimmed.startsWith(`${VPS_COWORK_ROOT}/`)) {
    return rewrite(VPS_COWORK_ROOT, trimmed.slice(VPS_COWORK_ROOT.length))
  }
  const macMatch = trimmed.match(/^(\/Users\/[^/]+\/Cowork)(\/.*)?$/)
  if (macMatch) {
    return rewrite(macMatch[1], macMatch[2] || '')
  }
  return null
}

/**
 * Rewrite all flat Partners-era Cowork path tokens inside free-form text
 * (AGENTS.md, CLAUDE.md, SOUL.md, wiki notes). Leaves wiki-vault and reserved
 * root paths alone.
 */
export function rewriteLegacyFlatCoworkPathsInText(
  text: string,
  nestingOrgSlug: string = PIB_COWORK_NESTING_SLUG,
): { text: string; changes: number } {
  if (!text) return { text, changes: 0 }
  const patterns = [
    /~\/Cowork\/[^\s`"'<>\])|,]+/g,
    /\/var\/lib\/hermes\/Cowork\/[^\s`"'<>\])|,]+/g,
    /\/Users\/[^/\s]+\/Cowork\/[^\s`"'<>\])|,]+/g,
  ]
  let next = text
  let changes = 0
  for (const pattern of patterns) {
    next = next.replace(pattern, (match) => {
      // Trim trailing punctuation commonly glued to markdown paths.
      let core = match
      let trailing = ''
      while (/[.,;:!?]$/.test(core)) {
        trailing = core.slice(-1) + trailing
        core = core.slice(0, -1)
      }
      const rewritten = rewriteLegacyFlatCoworkPath(core, nestingOrgSlug)
      if (!rewritten || rewritten === core) return match
      changes += 1
      return `${rewritten}${trailing}`
    })
  }
  return { text: next, changes }
}
