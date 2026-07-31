import type { ProgressiveSkillMeta } from './types'

/**
 * Progressive disclosure: catalog returns metadata only; loadSkillBody attaches body when selected.
 */
export function skillCatalogFromDocs(
  docs: Array<{ id: string; name: string; description: string; path?: string; tags?: string[]; body?: string }>,
): ProgressiveSkillMeta[] {
  return docs.map((doc) => ({
    id: doc.id,
    name: doc.name,
    description: doc.description,
    path: doc.path,
    tags: doc.tags,
    loaded: false,
    // Never put full body in the catalog listing
  }))
}

export function selectSkillsForRequest(
  catalog: ProgressiveSkillMeta[],
  query: string,
  limit = 3,
): ProgressiveSkillMeta[] {
  const q = query.trim().toLowerCase()
  if (!q) return catalog.slice(0, limit)
  const scored = catalog.map((skill) => {
    const hay = [skill.name, skill.description, ...(skill.tags || []), skill.id].join(' ').toLowerCase()
    let score = 0
    for (const token of q.split(/\s+/).filter(Boolean)) {
      if (hay.includes(token)) score += 1
      if (skill.name.toLowerCase().includes(token)) score += 2
    }
    return { skill, score }
  })
  return scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, limit)
    .map((row) => row.skill)
}

export function loadSkillBody(
  catalog: ProgressiveSkillMeta[],
  skillId: string,
  body: string,
): ProgressiveSkillMeta[] {
  return catalog.map((skill) => {
    if (skill.id !== skillId) return skill
    return { ...skill, loaded: true, body }
  })
}

export function progressiveSkillsDispatchBlock(
  loaded: ProgressiveSkillMeta[],
): string {
  const ready = loaded.filter((s) => s.loaded && s.body)
  if (ready.length === 0) {
    return [
      '[Hermes skills — progressive]',
      'No skill bodies loaded. Use catalog metadata only until a skill is explicitly selected.',
      '',
    ].join('\n')
  }
  return [
    '[Hermes skills — progressive loaded]',
    ...ready.map((s) => `## ${s.name} (${s.id})\n${s.body}`),
    '',
  ].join('\n')
}
