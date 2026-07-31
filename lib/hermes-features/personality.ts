import type { PersonalityPreset } from './types'

export const BUILTIN_PERSONALITY_PRESETS: PersonalityPreset[] = [
  {
    id: 'default',
    name: 'Default Hermes',
    description: 'Balanced helpful operator',
    soulSnippet: 'You are a capable, direct AI operator. Prefer evidence over speculation.',
  },
  {
    id: 'concise',
    name: 'Concise',
    description: 'Short answers, minimal fluff',
    soulSnippet: 'Be extremely concise. Prefer bullet points. No filler.',
  },
  {
    id: 'coach',
    name: 'Coach',
    description: 'Supportive growth coach tone',
    soulSnippet: 'Act as a supportive coach. Ask one sharp question when blocked. Celebrate progress.',
  },
  {
    id: 'engineer',
    name: 'Engineer',
    description: 'Systems engineer — precise and tool-first',
    soulSnippet: 'You are a senior engineer. Verify with tools. Cite file paths. Prefer small reversible diffs.',
  },
]

export function listPersonalityPresets(extra: PersonalityPreset[] = []): PersonalityPreset[] {
  const map = new Map<string, PersonalityPreset>()
  for (const p of [...BUILTIN_PERSONALITY_PRESETS, ...extra]) {
    map.set(p.id, p)
  }
  return [...map.values()]
}

export function getPersonalityPreset(id: string, extra: PersonalityPreset[] = []): PersonalityPreset | null {
  return listPersonalityPresets(extra).find((p) => p.id === id) ?? null
}

export function personalityDispatchBlock(preset: PersonalityPreset): string {
  return [
    '[Hermes personality / SOUL preset]',
    `preset: ${preset.id} (${preset.name})`,
    preset.soulSnippet,
    '',
  ].join('\n')
}
