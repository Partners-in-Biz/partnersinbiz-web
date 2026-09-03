export function sanitizeInlineSvg(svg: string): string | null {
  const trimmed = svg.trim()
  if (!/^<svg\b[\s\S]*<\/svg>$/i.test(trimmed)) return null
  if (/<script\b|\son[a-z]+\s*=|javascript:/i.test(trimmed)) return null
  return trimmed
}
