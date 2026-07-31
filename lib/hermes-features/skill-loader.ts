/**
 * Progressive skill loader: resolve SKILL.md bodies from repo skill roots.
 * Catalog stays metadata-only; bodies load only for selected skill ids.
 */
import fs from 'fs'
import path from 'path'
import { selectSkillsForRequest, skillCatalogFromDocs } from './skills-progressive'
import type { ProgressiveSkillMeta } from './types'

const MAX_BODY_CHARS = 24_000

export interface SkillDocSource {
  id: string
  name: string
  description: string
  path?: string
  tags?: string[]
  body?: string
}

function skillRoots(cwd = process.cwd()): string[] {
  return [
    path.join(cwd, 'packs', 'pib-system-skills', 'skills'),
    path.join(cwd, '.claude', 'skills'),
    path.join(cwd, 'packs', 'skills'),
  ]
}

function normalizeSkillId(raw: string): string {
  return raw
    .trim()
    .replace(/^partnersinbiz\//i, '')
    .replace(/^pib\//i, '')
    .replace(/\/SKILL\.md$/i, '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() || raw.trim()
}

function parseFrontmatter(raw: string): { name?: string; description?: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { body: raw }
  const block = match[1] || ''
  const body = (match[2] || '').trimStart()
  const nameMatch = block.match(/^name:\s*(.+)$/m)
  const descMatch = block.match(/^description:\s*>?\s*([\s\S]*?)(?=\n[a-zA-Z_][\w-]*:|\n*$)/m)
  let description = (descMatch?.[1] || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
  if (description.length > 280) description = `${description.slice(0, 277)}…`
  return {
    name: nameMatch?.[1]?.trim(),
    description: description || undefined,
    body: body || raw,
  }
}

/** Resolve absolute SKILL.md path for a skill id, if present. */
export function resolveSkillMdPath(skillId: string, cwd = process.cwd()): string | null {
  const id = normalizeSkillId(skillId)
  if (!id || id.includes('..')) return null
  for (const root of skillRoots(cwd)) {
    const candidate = path.join(root, id, 'SKILL.md')
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Read one skill body from disk (truncated). Returns null if missing. */
export function readSkillBody(skillId: string, cwd = process.cwd()): string | null {
  const abs = resolveSkillMdPath(skillId, cwd)
  if (!abs) return null
  try {
    const raw = fs.readFileSync(abs, 'utf8')
    const { body } = parseFrontmatter(raw)
    if (body.length > MAX_BODY_CHARS) return `${body.slice(0, MAX_BODY_CHARS)}\n…[truncated]`
    return body
  } catch {
    return null
  }
}

/** Build progressive catalog entries (no bodies) from skill name list. */
export function buildSkillCatalogFromNames(
  skillNames: string[],
  cwd = process.cwd(),
): ProgressiveSkillMeta[] {
  const docs: SkillDocSource[] = []
  for (const raw of skillNames) {
    const id = normalizeSkillId(raw)
    if (!id || docs.some((d) => d.id === id)) continue
    const abs = resolveSkillMdPath(id, cwd)
    let name = id
    let description = `Agent skill: ${id}`
    if (abs) {
      try {
        const rawMd = fs.readFileSync(abs, 'utf8')
        const parsed = parseFrontmatter(rawMd)
        if (parsed.name) name = parsed.name
        if (parsed.description) description = parsed.description
      } catch {
        /* keep defaults */
      }
    }
    docs.push({
      id,
      name,
      description,
      path: abs || undefined,
      tags: [id, name.toLowerCase()],
    })
  }
  return skillCatalogFromDocs(docs)
}

/**
 * Progressive selection: pick top skills for the user message, load only those bodies.
 */
export function loadProgressiveSkillBodies(
  skillNames: string[],
  userMessage: string,
  options: { limit?: number; cwd?: string } = {},
): {
  catalog: ProgressiveSkillMeta[]
  bodies: Record<string, string>
  selectedIds: string[]
} {
  const cwd = options.cwd ?? process.cwd()
  const limit = options.limit ?? 3
  const catalog = buildSkillCatalogFromNames(skillNames, cwd)
  const selected = selectSkillsForRequest(catalog, userMessage, limit)
  // If query scores nothing, still load top N catalog skills so agents aren't body-less
  const picks = selected.length > 0 ? selected : catalog.slice(0, limit)
  const bodies: Record<string, string> = {}
  const selectedIds: string[] = []
  for (const skill of picks) {
    const body = readSkillBody(skill.id, cwd)
    if (body) {
      bodies[skill.id] = body
      selectedIds.push(skill.id)
    }
  }
  return { catalog, bodies, selectedIds }
}
