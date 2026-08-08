/**
 * Design Context — per-client structured design system record.
 *
 * Port of the Impeccable (Apache 2.0) PRODUCT.md / DESIGN.md context pattern
 * (research item ZTTo7g6CU80u1uUSZvoC, P0 "Per-client design context") into a
 * versioned Research-kind record so agents stay on-brand instead of defaulting
 * to generic SaaS patterns.
 *
 * Stored as a `research_items` row with kind='design'. The structured payload
 * lives in `designContext`; every save bumps `version` and pushes the previous
 * payload into `history` (capped) so the record is auditable.
 */

export type DesignContextGatherPath = 'questionnaire' | 'style-scan' | 'manual'

export type DesignSurfaceMode = 'persuade' | 'operate' | 'read' | 'experience'

export interface DesignPaletteColor {
  /** Role name, e.g. `primary`, `accent`, `background`, `text`. */
  name: string
  /** Color value as authored, e.g. `#0F172A` or `oklch(...)`. */
  value: string
  /** Optional usage note (e.g. "buttons", "links", "page background"). */
  usage?: string
}

export interface DesignTypeRole {
  /** Role: display / heading / body / mono / label. */
  role: 'display' | 'heading' | 'body' | 'mono' | 'label'
  /** Font family stack as authored. */
  family: string
  /** Optional size/scale note (e.g. "clamp(2.5rem, 6vw, 4rem)"). */
  scale?: string
}

export interface DesignScaleToken {
  /** Token name, e.g. `sm`, `md`, `lg` or `--radius-2`. */
  name: string
  /** Value, e.g. `8px`, `0.5rem`, `1.25rem`. */
  value: string
}

export interface DesignSurfaceModeEntry {
  /** Surface name, e.g. `landing`, `dashboard`, `docs`, `portfolio`. */
  surface: string
  mode: DesignSurfaceMode
  /** Optional note on what the mode demands here. */
  notes?: string
}

export interface DesignContextPayload {
  /** Who the product/site is for and what they need. */
  audience: string
  /** Where the client sits in the market / what they own. */
  positioning: string
  /** Brand voice: tone, words, do/don't. */
  brandVoice: string
  /** Things to explicitly avoid (anti-references, slop tells). */
  antiReferences: string[]
  /** Named palette colors. */
  palette: DesignPaletteColor[]
  /** Type stack per role. */
  typeStack: DesignTypeRole[]
  /** Component rules (do/don't for buttons, cards, nav, etc.). */
  componentRules: string[]
  /** Radius scale tokens. */
  radiusScale: DesignScaleToken[]
  /** Elevation (shadow) scale tokens. */
  elevationScale: DesignScaleToken[]
  /** Per-surface mode (Persuade / Operate / Read / Experience). */
  surfaceModes: DesignSurfaceModeEntry[]
}

export interface DesignContextHistoryEntry {
  version: number
  payload: DesignContextPayload
  source: DesignContextGatherPath
  sourceUrl?: string
  updatedAt?: unknown
  updatedBy?: string
}

export interface DesignContextRecord extends DesignContextPayload {
  version: number
  source: DesignContextGatherPath
  sourceUrl?: string
  updatedAt?: unknown
  updatedBy?: string
  history: DesignContextHistoryEntry[]
}

export const DESIGN_SURFACE_MODES: readonly DesignSurfaceMode[] = ['persuade', 'operate', 'read', 'experience'] as const

export const DESIGN_GATHER_PATHS: readonly DesignContextGatherPath[] = ['questionnaire', 'style-scan', 'manual'] as const

export const DESIGN_PALETTE_ROLE_ORDER = ['primary', 'secondary', 'accent', 'background', 'text', 'muted'] as const

export const DESIGN_TYPE_ROLES = ['display', 'heading', 'body', 'mono', 'label'] as const

export const DESIGN_HISTORY_CAP = 10

export function isDesignSurfaceMode(value: unknown): value is DesignSurfaceMode {
  return typeof value === 'string' && (DESIGN_SURFACE_MODES as readonly string[]).includes(value)
}

export function isDesignGatherPath(value: unknown): value is DesignContextGatherPath {
  return typeof value === 'string' && (DESIGN_GATHER_PATHS as readonly string[]).includes(value)
}

function cleanText(value: unknown, max = 8_000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function cleanStringArray(value: unknown, max = 100, maxItems = 50): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((item) => cleanText(item, max))
        .filter((item) => item.length > 0),
    ),
  ).slice(0, maxItems)
}

function cleanPalette(value: unknown): DesignPaletteColor[] {
  if (!Array.isArray(value)) return []
  const out: DesignPaletteColor[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const name = cleanText(rec.name, 80)
    const color = cleanText(rec.value, 120)
    if (!name || !color) continue
    out.push({ name, value: color, ...(cleanText(rec.usage, 200) ? { usage: cleanText(rec.usage, 200) } : {}) })
  }
  // De-dupe by name (case-insensitive), keep first.
  const seen = new Set<string>()
  return out.filter((color) => {
    const key = color.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 40)
}

function cleanTypeStack(value: unknown): DesignTypeRole[] {
  if (!Array.isArray(value)) return []
  const out: DesignTypeRole[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const role = cleanText(rec.role, 40).toLowerCase()
    if (!(DESIGN_TYPE_ROLES as readonly string[]).includes(role)) continue
    const family = cleanText(rec.family, 300)
    if (!family) continue
    out.push({ role: role as DesignTypeRole['role'], family, ...(cleanText(rec.scale, 200) ? { scale: cleanText(rec.scale, 200) } : {}) })
  }
  const seen = new Set<string>()
  return out.filter((entry) => {
    const key = `${entry.role}:${entry.family.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 20)
}

function cleanScaleTokens(value: unknown, max = 60): DesignScaleToken[] {
  if (!Array.isArray(value)) return []
  const out: DesignScaleToken[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const name = cleanText(rec.name, 80)
    const tokenValue = cleanText(rec.value, 120)
    if (!name || !tokenValue) continue
    out.push({ name, value: tokenValue })
  }
  const seen = new Set<string>()
  return out.filter((token) => {
    const key = token.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, max)
}

function cleanSurfaceModes(value: unknown): DesignSurfaceModeEntry[] {
  if (!Array.isArray(value)) return []
  const out: DesignSurfaceModeEntry[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const surface = cleanText(rec.surface, 120)
    const mode = cleanText(rec.mode, 40).toLowerCase()
    if (!surface || !isDesignSurfaceMode(mode)) continue
    out.push({ surface, mode, ...(cleanText(rec.notes, 300) ? { notes: cleanText(rec.notes, 300) } : {}) })
  }
  const seen = new Set<string>()
  return out.filter((entry) => {
    const key = entry.surface.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 30)
}

/** Normalize an inbound payload into a clean, store-safe DesignContextPayload. */
export function normalizeDesignContextPayload(value: unknown): DesignContextPayload {
  const rec = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  return {
    audience: cleanText(rec.audience),
    positioning: cleanText(rec.positioning),
    brandVoice: cleanText(rec.brandVoice),
    antiReferences: cleanStringArray(rec.antiReferences),
    palette: cleanPalette(rec.palette),
    typeStack: cleanTypeStack(rec.typeStack),
    componentRules: cleanStringArray(rec.componentRules, 500),
    radiusScale: cleanScaleTokens(rec.radiusScale),
    elevationScale: cleanScaleTokens(rec.elevationScale),
    surfaceModes: cleanSurfaceModes(rec.surfaceModes),
  }
}

/** True when a payload carries at least one meaningful design fact. */
export function hasDesignContextFacts(payload: DesignContextPayload): boolean {
  return Boolean(
    payload.audience
    || payload.positioning
    || payload.brandVoice
    || payload.antiReferences.length > 0
    || payload.palette.length > 0
    || payload.typeStack.length > 0
    || payload.componentRules.length > 0
    || payload.radiusScale.length > 0
    || payload.elevationScale.length > 0
    || payload.surfaceModes.length > 0,
  )
}

/**
 * Build a new DesignContextRecord from an inbound payload.
 * The record's `history` is replaced by the caller when updating (the caller
 * owns the previous record); `history` starts empty for a fresh record.
 */
export function buildDesignContextRecord(input: {
  payload: DesignContextPayload
  source: DesignContextGatherPath
  sourceUrl?: string
  previous?: DesignContextRecord | null
  updatedBy?: string
}): DesignContextRecord {
  const previous = input.previous
  const nextVersion = previous ? previous.version + 1 : 1
  const previousHistory: DesignContextHistoryEntry[] = Array.isArray(previous?.history) ? previous.history : []
  const history: DesignContextHistoryEntry[] = [
    ...(previous
      ? [{
          version: previous.version,
          payload: {
            audience: previous.audience,
            positioning: previous.positioning,
            brandVoice: previous.brandVoice,
            antiReferences: previous.antiReferences,
            palette: previous.palette,
            typeStack: previous.typeStack,
            componentRules: previous.componentRules,
            radiusScale: previous.radiusScale,
            elevationScale: previous.elevationScale,
            surfaceModes: previous.surfaceModes,
          } as DesignContextPayload,
          source: previous.source,
          ...(previous.sourceUrl ? { sourceUrl: previous.sourceUrl } : {}),
          ...(previous.updatedAt ? { updatedAt: previous.updatedAt } : {}),
          ...(previous.updatedBy ? { updatedBy: previous.updatedBy } : {}),
        } satisfies DesignContextHistoryEntry]
      : []),
    ...previousHistory,
  ].slice(0, DESIGN_HISTORY_CAP)

  return {
    ...input.payload,
    version: nextVersion,
    source: input.source,
    ...(input.sourceUrl?.trim() ? { sourceUrl: input.sourceUrl.trim() } : {}),
    history,
    ...(input.updatedBy ? { updatedBy: input.updatedBy } : {}),
  }
}
