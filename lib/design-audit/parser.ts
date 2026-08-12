/**
 * Tolerant, dependency-free HTML/JSX-ish parser for the Design Audit engine.
 *
 * This is a source scanner, not a full HTML5 parser: it builds a minimal tree
 * with attributes, classes, inline styles, text, line numbers and comments so
 * the deterministic rules can run without a browser. It deliberately tolerates
 * JSX/TSX input (className, brace expressions) so the same engine can scan
 * framework source files the way the Impeccable CLI does.
 */

import type { CommentNode, DocumentNode, ElementNode, ScriptBlock, StyleBlock } from './types'

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
])

const RAWTEXT_ELEMENTS = new Set(['script', 'style'])

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

export function countNewlines(s: string): number {
  let count = 0
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) count++
  return count
}

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const code = parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m
    })
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = parseInt(dec, 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m
    })
}

export function parseStyle(styleStr: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!styleStr) return out
  for (const decl of styleStr.split(';')) {
    const idx = decl.indexOf(':')
    if (idx === -1) continue
    const prop = decl.slice(0, idx).trim().toLowerCase()
    const value = decl.slice(idx + 1).trim()
    if (prop && value) out[prop] = value
  }
  return out
}

function parseAttrs(inner: string): Array<[string, string | null]> {
  const out: Array<[string, string | null]> = []
  let j = 0
  while (j < inner.length) {
    while (j < inner.length && /\s/.test(inner[j])) j++
    if (j >= inner.length) break
    let name = ''
    while (j < inner.length && !/[\s=/>]/.test(inner[j])) {
      name += inner[j]
      j++
    }
    if (!name) {
      j++
      continue
    }
    name = name.toLowerCase()
    while (j < inner.length && /\s/.test(inner[j])) j++
    if (inner[j] === '=') {
      j++
      while (j < inner.length && /\s/.test(inner[j])) j++
      let value = ''
      const c = inner[j]
      if (c === '"' || c === "'") {
        j++
        while (j < inner.length && inner[j] !== c) {
          value += inner[j]
          j++
        }
        if (j < inner.length) j++ // closing quote
        out.push([name, decodeEntities(value.trim())])
      } else if (c === '{') {
        // JSX expression: capture until the matching close brace, quotes included.
        let depth = 0
        while (j < inner.length) {
          const ch = inner[j]
          if (ch === '{') depth++
          else if (ch === '}') {
            depth--
            if (depth === 0) {
              j++
              break
            }
          }
          value += ch
          j++
        }
        out.push([name, value.trim()])
      } else {
        while (j < inner.length && !/[\s>]/.test(inner[j])) {
          value += inner[j]
          j++
        }
        out.push([name, decodeEntities(value.trim())])
      }
    } else {
      out.push([name, null])
    }
  }
  return out
}

export function parseHtml(source: string): DocumentNode {
  const root: ElementNode = {
    tag: '#root',
    attrs: {},
    classes: [],
    style: {},
    rawStyle: '',
    text: '',
    children: [],
    parent: null,
    line: 1,
  }
  const comments: CommentNode[] = []
  const styleBlocks: StyleBlock[] = []
  const scriptBlocks: ScriptBlock[] = []
  const stack: ElementNode[] = [root]
  let line = 1
  let i = 0
  const n = source.length

  while (i < n) {
    // Skip JS/JSX comments so comment text (which may contain <tag> lookalikes
    // like `<img>` in a doc comment) is never parsed as elements. `/* ... */`
    // covers JSDoc and JSX `{/* */}`; `//` covers line comments. A `//` that
    // is part of a URL (`https://`) is not a comment — guard on the previous
    // char so text content like `see https://example.com` survives intact.
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2)
      const endIdx = end === -1 ? n : end + 2
      const raw = source.slice(i, endIdx)
      line += countNewlines(raw)
      i = endIdx
      continue
    }
    if (source.startsWith('//', i) && (i === 0 || source[i - 1] !== ':')) {
      const end = source.indexOf('\n', i)
      const endIdx = end === -1 ? n : end
      const raw = source.slice(i, endIdx)
      line += countNewlines(raw)
      i = endIdx
      continue
    }
    const lt = source.indexOf('<', i)
    if (lt === -1) {
      const text = source.slice(i)
      stack[stack.length - 1].text += decodeEntities(text)
      break
    }
    if (lt > i) {
      const text = source.slice(i, lt)
      stack[stack.length - 1].text += decodeEntities(text)
      line += countNewlines(text)
      i = lt
      continue
    }
    // At '<'.
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4)
      const endIdx = end === -1 ? n : end + 3
      const raw = source.slice(i, endIdx)
      comments.push({ text: raw, line })
      line += countNewlines(raw)
      i = endIdx
      continue
    }
    if (source.startsWith('<!', i) || source.startsWith('<?', i)) {
      const end = source.indexOf('>', i)
      const endIdx = end === -1 ? n : end + 1
      line += countNewlines(source.slice(i, endIdx))
      i = endIdx
      continue
    }
    if (source.startsWith('</', i)) {
      const end = source.indexOf('>', i)
      const endIdx = end === -1 ? n : end + 1
      const raw = source.slice(i, endIdx)
      const tag = raw.slice(2, raw.length - 1).trim().split(/[\s>]/)[0]?.toLowerCase()
      if (tag) {
        for (let k = stack.length - 1; k >= 1; k--) {
          if (stack[k].tag === tag) {
            stack.length = k
            break
          }
          // Tolerant: a mismatched close just drops the top frame.
          stack.length = k
          break
        }
      }
      line += countNewlines(raw)
      i = endIdx
      continue
    }
    // Opening tag. Scan to '>' respecting quotes and JSX brace depth.
    let j = i + 1
    let quote: string | null = null
    let braceDepth = 0
    while (j < n) {
      const ch = source[j]
      if (quote) {
        if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'") {
        quote = ch
      } else if (ch === '{') {
        braceDepth++
      } else if (ch === '}') {
        braceDepth = Math.max(0, braceDepth - 1)
      } else if (ch === '>' && braceDepth === 0) {
        break
      }
      j++
    }
    const endIdx = j >= n ? n : j + 1
    const raw = source.slice(i, endIdx)
    const inner = raw.slice(1, raw.length - 1).trim()
    const tagMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(inner)
    if (!tagMatch) {
      // Not a real tag (e.g. stray '<' in text); treat as text.
      stack[stack.length - 1].text += decodeEntities('<')
      i = i + 1
      line += 1
      continue
    }
    const tag = tagMatch[0].toLowerCase()
    const selfClosing = raw.trimEnd().endsWith('/>')
    const attrs = parseAttrs(inner.slice(tagMatch[0].length))
    const attrMap: Record<string, string | null> = {}
    for (const [name, value] of attrs) attrMap[name] = value
    const classes = (attrMap['class'] ?? attrMap['classname'] ?? '').split(/\s+/).filter(Boolean)
    const rawStyle = attrMap['style'] ?? ''
    const style = rawStyle && !rawStyle.includes('{') ? parseStyle(rawStyle) : {}
    const node: ElementNode = {
      tag,
      attrs: attrMap,
      classes,
      style,
      rawStyle,
      text: '',
      children: [],
      parent: stack[stack.length - 1],
      line,
    }
    stack[stack.length - 1].children.push(node)
    line += countNewlines(raw)
    i = endIdx

    if (selfClosing || VOID_ELEMENTS.has(tag)) continue

    if (RAWTEXT_ELEMENTS.has(tag)) {
      // Capture script/style bodies without polluting the tree (their text must
      // never feed buzzword/em-dash rules).
      const closeRe = new RegExp(`</${tag}\\s*>`, 'i')
      const rest = source.slice(i)
      const close = rest.search(closeRe)
      const bodyEnd = close === -1 ? rest.length : close
      const body = rest.slice(0, bodyEnd)
      line += countNewlines(body)
      if (tag === 'style') styleBlocks.push({ css: body, line: node.line })
      else scriptBlocks.push({ js: body, line: node.line })
      if (close === -1) break
      const closeRaw = rest.slice(bodyEnd, bodyEnd + rest.slice(bodyEnd).indexOf('>') + 1)
      line += countNewlines(closeRaw)
      i = i + bodyEnd + closeRaw.length
      continue
    }

    stack.push(node)
  }

  return { root, comments, styleBlocks, scriptBlocks }
}

export function isHeading(el: ElementNode): boolean {
  return HEADING_TAGS.has(el.tag)
}

export function isVoidElement(tag: string): boolean {
  return VOID_ELEMENTS.has(tag)
}

export function walk(node: ElementNode, cb: (el: ElementNode) => void): void {
  cb(node)
  for (const child of node.children) walk(child, cb)
}

export function textContent(node: ElementNode): string {
  let out = node.text
  for (const child of node.children) out += (out ? ' ' : '') + textContent(child)
  return out
}

/** CSS-ish path ref, e.g. `body > main > section:nth-of-type(2) > div.card:nth-of-type(1)`. */
export function pathOf(node: ElementNode): string {
  const parts: string[] = []
  let cur: ElementNode | null = node
  while (cur && cur.tag !== '#root') {
    const siblings = cur.parent ? cur.parent.children.filter((c) => c.tag === cur!.tag) : []
    const idx = siblings.indexOf(cur) + 1
    const cls = cur.classes.length ? '.' + cur.classes.slice(0, 3).join('.') : ''
    parts.unshift(`${cur.tag}${cls}:nth-of-type(${idx})`)
    cur = cur.parent
  }
  return parts.join(' > ')
}

export function snippet(text: string, max = 70): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned.length > max ? cleaned.slice(0, max - 1) + '…' : cleaned
}
