import type { RichMessagePart } from '@/lib/hermes/types'

const FENCE_RE = /```(pib:chart|pib:mermaid|pib:math|pib:html|mermaid|mmd)\n([\s\S]*?)```/g

export function extractPibFences(markdown: string): { markdown: string; parts: RichMessagePart[] } {
  if (!markdown) return { markdown: '', parts: [] }
  const parts: RichMessagePart[] = []
  let index = 0
  const next = markdown.replace(FENCE_RE, (full, info: string, body: string) => {
    const source = body.trim()
    if (info === 'pib:chart') {
      try {
        const parsed = JSON.parse(source) as Record<string, unknown>
        parts.push({ type: 'chart', ...parsed })
      } catch {
        return full
      }
    } else if (info === 'pib:mermaid' || info === 'mermaid' || info === 'mmd') {
      parts.push({ type: 'mermaid', source })
    } else if (info === 'pib:math') {
      parts.push({ type: 'math', latex: source })
    } else if (info === 'pib:html') {
      parts.push({ type: 'html_artifact', title: 'Artifact', html: source })
    } else {
      return full
    }
    const placeholder = `<!--pib-part:${index}-->`
    index += 1
    return placeholder
  })
  return { markdown: next, parts }
}
