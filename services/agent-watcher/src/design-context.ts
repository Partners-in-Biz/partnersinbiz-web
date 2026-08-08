/**
 * Design-context prompt block for agent task dispatch.
 *
 * Reads the org's latest Design Context research record (kind='design') and
 * renders a compact, prompt-safe block so every web/design/SEO task carries
 * the client's brand facts instead of defaulting to generic SaaS patterns.
 * Mirrors the /impeccable context-file injection pattern.
 */
import { db } from './firestore'
import { logger } from './logger'

const RESEARCH_COLLECTION = 'research_items'

interface DesignContextPayload {
  audience?: string
  positioning?: string
  brandVoice?: string
  antiReferences?: string[]
  palette?: Array<{ name?: string; value?: string; usage?: string }>
  typeStack?: Array<{ role?: string; family?: string; scale?: string }>
  componentRules?: string[]
  radiusScale?: Array<{ name?: string; value?: string }>
  elevationScale?: Array<{ name?: string; value?: string }>
  surfaceModes?: Array<{ surface?: string; mode?: string; notes?: string }>
  version?: number
  source?: string
  sourceUrl?: string
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function hasFacts(payload: DesignContextPayload | undefined | null): boolean {
  if (!payload || typeof payload !== 'object') return false
  return Boolean(
    cleanText(payload.audience, 1)
    || cleanText(payload.positioning, 1)
    || cleanText(payload.brandVoice, 1)
    || (Array.isArray(payload.antiReferences) && payload.antiReferences.length > 0)
    || (Array.isArray(payload.palette) && payload.palette.length > 0)
    || (Array.isArray(payload.typeStack) && payload.typeStack.length > 0)
    || (Array.isArray(payload.componentRules) && payload.componentRules.length > 0)
    || (Array.isArray(payload.radiusScale) && payload.radiusScale.length > 0)
    || (Array.isArray(payload.elevationScale) && payload.elevationScale.length > 0)
    || (Array.isArray(payload.surfaceModes) && payload.surfaceModes.length > 0),
  )
}

function updatedAtMillis(item: Record<string, unknown>): number {
  const raw = item.updatedAt ?? item.createdAt
  if (raw && typeof raw === 'object') {
    const stamp = raw as { toMillis?: () => number; _seconds?: number }
    if (typeof stamp.toMillis === 'function') return stamp.toMillis()
    if (typeof stamp._seconds === 'number') return stamp._seconds * 1000
  }
  if (typeof raw === 'string' && Number.isFinite(Date.parse(raw))) return Date.parse(raw)
  return 0
}

/** Latest design-context record for an org, or null. Query by org only to avoid composite-index blockers. */
export async function loadLatestDesignContext(orgId: string): Promise<{ id: string; payload: DesignContextPayload } | null> {
  if (!orgId?.trim()) return null
  try {
    const snap = await db.collection(RESEARCH_COLLECTION).where('orgId', '==', orgId.trim()).get()
    const candidates: Array<{ id: string; updatedAt: number; payload: DesignContextPayload }> = []
    snap.docs.forEach((doc) => {
      const data = doc.data() as Record<string, unknown>
      if (data.deleted === true) return
      if (data.status === 'archived') return
      if (data.kind !== 'design') return
      const payload = data.designContext as DesignContextPayload | undefined
      if (!hasFacts(payload)) return
      candidates.push({ id: doc.id, updatedAt: updatedAtMillis(data), payload: payload! })
    })
    if (candidates.length === 0) return null
    candidates.sort((a, b) => b.updatedAt - a.updatedAt)
    return { id: candidates[0]!.id, payload: candidates[0]!.payload }
  } catch (err) {
    logger.warn('failed to load design context for dispatch prompt', {
      orgId,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

const MAX_LINE = 240

function listLines(values: unknown, formatter: (value: unknown) => string, max = 8): string[] {
  if (!Array.isArray(values)) return []
  return values
    .map(formatter)
    .filter(Boolean)
    .slice(0, max)
}

function renderDesignContextBlock(record: { id: string; payload: DesignContextPayload }): string {
  const p = record.payload
  const lines: string[] = ['## Design context (per-client)', 'Stay on-brand: apply these client design facts before defaulting to generic SaaS patterns.']

  const audience = cleanText(p.audience, MAX_LINE)
  if (audience) lines.push(`- Audience: ${audience}`)
  const positioning = cleanText(p.positioning, MAX_LINE)
  if (positioning) lines.push(`- Positioning: ${positioning}`)
  const voice = cleanText(p.brandVoice, MAX_LINE)
  if (voice) lines.push(`- Brand voice: ${voice}`)

  const antiRefs = listLines(p.antiReferences, (value) => cleanText(value, 200))
  if (antiRefs.length > 0) lines.push(`- Anti-references (avoid): ${antiRefs.join('; ')}`)

  const palette = listLines(p.palette, (value) => {
    const rec = value as { name?: string; value?: string; usage?: string }
    const name = cleanText(rec.name, 60)
    const color = cleanText(rec.value, 80)
    if (!name || !color) return ''
    return rec.usage ? `${name} ${color} (${cleanText(rec.usage, 80)})` : `${name} ${color}`
  }, 12)
  if (palette.length > 0) lines.push(`- Palette: ${palette.join(' | ')}`)

  const typeStack = listLines(p.typeStack, (value) => {
    const rec = value as { role?: string; family?: string; scale?: string }
    const role = cleanText(rec.role, 30)
    const family = cleanText(rec.family, 120)
    if (!family) return ''
    return `${role || 'body'} ${family}${rec.scale ? ` (${cleanText(rec.scale, 80)})` : ''}`
  }, 12)
  if (typeStack.length > 0) lines.push(`- Type stack: ${typeStack.join(' | ')}`)

  const components = listLines(p.componentRules, (value) => cleanText(value, 200))
  if (components.length > 0) lines.push(`- Component rules: ${components.join('; ')}`)

  const radius = listLines(p.radiusScale, (value) => {
    const rec = value as { name?: string; value?: string }
    return rec.name && rec.value ? `${rec.name}=${rec.value}` : ''
  }, 10)
  if (radius.length > 0) lines.push(`- Radius scale: ${radius.join(' | ')}`)

  const elevation = listLines(p.elevationScale, (value) => {
    const rec = value as { name?: string; value?: string }
    return rec.name && rec.value ? `${rec.name}=${rec.value}` : ''
  }, 10)
  if (elevation.length > 0) lines.push(`- Elevation scale: ${elevation.join(' | ')}`)

  const modes = listLines(p.surfaceModes, (value) => {
    const rec = value as { surface?: string; mode?: string; notes?: string }
    const surface = cleanText(rec.surface, 80)
    const mode = cleanText(rec.mode, 40)
    if (!surface || !mode) return ''
    return `${surface} → ${mode}${rec.notes ? ` (${cleanText(rec.notes, 120)})` : ''}`
  }, 12)
  if (modes.length > 0) lines.push(`- Surface modes: ${modes.join(' | ')}`)

  const source = cleanText(p.sourceUrl, 160)
  if (source) lines.push(`- Source: ${source}`)
  lines.push(`Design Context record: research_items/${record.id}; version ${cleanText(p.version, 20) || '?'}; prefer the record's structured fields over this condensed summary when building UI.`)
  return lines.join('\n')
}

/** Build the design-context prompt block for a task org, or '' when none exists. */
export async function buildDesignContextPromptBlock(orgId: string | undefined): Promise<string> {
  if (!orgId?.trim()) return ''
  const record = await loadLatestDesignContext(orgId)
  if (!record) return ''
  return renderDesignContextBlock(record)
}
