/**
 * Hermes sometimes re-emits the full assistant reply as each "delta".
 * Treat cumulative snapshots as replace, not append.
 */
export function applyAssistantTextDelta(current: string, delta: string): string {
  const next = typeof delta === 'string' ? delta : ''
  if (!next) return current
  if (!current) return next
  if (next === current) return current
  if (current.endsWith(next)) return current
  if (next.startsWith(current)) return next
  // Full-paragraph replay: the new delta is already present as a complete block.
  if (next.length >= 40 && (current.includes(`\n\n${next}`) || current.startsWith(`${next}\n\n`) || current.includes(next))) {
    return current
  }
  return `${current}${next}`
}
