import React from 'react'

/**
 * Tiny zero-dependency markdown renderer for blog body preview.
 * Handles: # / ## / ### headings, paragraphs, **bold**, *italic*,
 * [text](url) links, unordered + ordered lists, blockquotes, horizontal rules.
 *
 * NOT a full markdown parser  -  but good enough for client-review previews.
 */
export function renderMarkdown(src: string): React.ReactNode {
  if (!src) return null
  // Normalise newlines.
  const lines = src.replace(/\r\n/g, '\n').split('\n')

  type Block =
    | { kind: 'h1' | 'h2' | 'h3'; text: string }
    | { kind: 'p'; text: string }
    | { kind: 'ul'; items: string[] }
    | { kind: 'ol'; items: string[] }
    | { kind: 'quote'; text: string }
    | { kind: 'hr' }

  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    if (/^#\s+/.test(line)) {
      blocks.push({ kind: 'h1', text: line.replace(/^#\s+/, '') })
      i++
      continue
    }
    if (/^##\s+/.test(line)) {
      blocks.push({ kind: 'h2', text: line.replace(/^##\s+/, '') })
      i++
      continue
    }
    if (/^###\s+/.test(line)) {
      blocks.push({ kind: 'h3', text: line.replace(/^###\s+/, '') })
      i++
      continue
    }
    if (/^---+\s*$/.test(line)) {
      blocks.push({ kind: 'hr' })
      i++
      continue
    }
    if (/^>\s+/.test(line)) {
      blocks.push({ kind: 'quote', text: line.replace(/^>\s+/, '') })
      i++
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      blocks.push({ kind: 'ul', items })
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push({ kind: 'ol', items })
      continue
    }
    // paragraph: gather consecutive non-empty, non-special lines
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^>\s+/.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i])
    ) {
      paraLines.push(lines[i])
      i++
    }
    blocks.push({ kind: 'p', text: paraLines.join(' ') })
  }

  return blocks.map((b, idx) => {
    switch (b.kind) {
      case 'h1':
        return (
          <h1 key={idx} style={{ fontSize: 32, fontWeight: 700, margin: '32px 0 16px', lineHeight: 1.2 }}>
            {inline(b.text)}
          </h1>
        )
      case 'h2':
        return (
          <h2 key={idx} style={{ fontSize: 24, fontWeight: 700, margin: '28px 0 12px', lineHeight: 1.25 }}>
            {inline(b.text)}
          </h2>
        )
      case 'h3':
        return (
          <h3 key={idx} style={{ fontSize: 19, fontWeight: 700, margin: '24px 0 10px', lineHeight: 1.3 }}>
            {inline(b.text)}
          </h3>
        )
      case 'p':
        return (
          <p key={idx} style={{ fontSize: 18, lineHeight: 1.7, margin: '0 0 20px', color: '#1F1F1F' }}>
            {inline(b.text)}
          </p>
        )
      case 'ul':
        return (
          <ul key={idx} style={{ margin: '0 0 20px', paddingLeft: 24, fontSize: 18, lineHeight: 1.7 }}>
            {b.items.map((it, j) => (
              <li key={j} style={{ marginBottom: 6 }}>
                {inline(it)}
              </li>
            ))}
          </ul>
        )
      case 'ol':
        return (
          <ol key={idx} style={{ margin: '0 0 20px', paddingLeft: 24, fontSize: 18, lineHeight: 1.7 }}>
            {b.items.map((it, j) => (
              <li key={j} style={{ marginBottom: 6 }}>
                {inline(it)}
              </li>
            ))}
          </ol>
        )
      case 'quote':
        return (
          <blockquote
            key={idx}
            style={{
              margin: '20px 0',
              padding: '6px 18px',
              borderLeft: '4px solid #ddd',
              color: '#444',
              fontStyle: 'italic',
              fontSize: 18,
              lineHeight: 1.6,
            }}
          >
            {inline(b.text)}
          </blockquote>
        )
      case 'hr':
        return <hr key={idx} style={{ border: 'none', borderTop: '1px solid #e6e6e6', margin: '32px 0' }} />
    }
  })
}

/** Render inline emphasis + links into JSX. */
function inline(text: string): React.ReactNode {
  // Pattern alternation order matters: links first, then bold, then italic.
  const tokens: Array<string | { kind: 'bold' | 'italic' | 'link'; text: string; href?: string }> = []
  let rest = text
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(rest)
    const boldMatch = /\*\*([^*]+)\*\*/.exec(rest)
    const italicMatch = /(?:^|[^*])\*([^*]+)\*/.exec(rest)

    const candidates: Array<{ idx: number; len: number; node: typeof tokens[number] }> = []
    if (linkMatch) candidates.push({ idx: linkMatch.index, len: linkMatch[0].length, node: { kind: 'link', text: linkMatch[1], href: linkMatch[2] } })
    if (boldMatch) candidates.push({ idx: boldMatch.index, len: boldMatch[0].length, node: { kind: 'bold', text: boldMatch[1] } })
    if (italicMatch) {
      // adjust index because the regex requires a non-* prefix
      const pre = italicMatch[0].startsWith('*') ? 0 : 1
      candidates.push({
        idx: italicMatch.index + pre,
        len: italicMatch[1].length + 2,
        node: { kind: 'italic', text: italicMatch[1] },
      })
    }
    if (candidates.length === 0) {
      tokens.push(rest)
      break
    }
    candidates.sort((a, b) => a.idx - b.idx)
    const next = candidates[0]
    if (next.idx > 0) tokens.push(rest.slice(0, next.idx))
    tokens.push(next.node)
    rest = rest.slice(next.idx + next.len)
  }
  return tokens.map((t, i) => {
    if (typeof t === 'string') return <React.Fragment key={i}>{t}</React.Fragment>
    if (t.kind === 'bold') return <strong key={i}>{t.text}</strong>
    if (t.kind === 'italic') return <em key={i}>{t.text}</em>
    return (
      <a key={i} href={t.href} style={{ color: '#1A8917', textDecoration: 'underline' }}>
        {t.text}
      </a>
    )
  })
}
