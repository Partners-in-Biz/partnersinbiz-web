/**
 * Ignore handling for the Design Audit engine.
 *
 * Implements the Impeccable-style ignore surface:
 *   - inline `<!-- impeccable-disable [rules] -->` / `impeccable-enable` comments
 *   - `impeccable-disable-line` and `impeccable-disable-next-line` forms
 *   - per-element `data-impeccable-disable="rule1,rule2"` attribute (per-value equivalent)
 *   - option-level ignoreRules / ignoreValues ('rule:value') / ignoreFiles (globs)
 */

import type { CommentNode, ElementNode, Finding, IgnoreOptions } from './types'
import { walkElements } from './style-utils'

export interface InlineIgnoreDirective {
  line: number
  kind: 'disable' | 'enable' | 'disable-line' | 'disable-next-line'
  rules: string[] // empty = all rules
}

const DIRECTIVE_RE = /impeccable-(disable|enable)(?:-(line|next-line))?(?:\s+([\w,\s-]+))?/i

export function parseInlineDirectives(comments: CommentNode[]): InlineIgnoreDirective[] {
  const out: InlineIgnoreDirective[] = []
  for (const comment of comments) {
    const match = DIRECTIVE_RE.exec(comment.text)
    if (!match) continue
    const kind = match[1].toLowerCase() as 'disable' | 'enable'
    const scope = match[2] ? (`${kind}-${match[2].toLowerCase()}` as 'disable-line' | 'disable-next-line') : kind
    const rules = (match[3] ?? '')
      .split(/[\s,]+/)
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean)
    out.push({ line: comment.line, kind: scope, rules })
  }
  return out
}

export interface InlineState {
  /** Rule id -> sorted [fromLine, toLine) intervals where the rule is disabled. */
  intervals: Map<string, Array<[number, number]>>
}

export function buildInlineState(directives: InlineIgnoreDirective[]): InlineState {
  const intervals = new Map<string, Array<[number, number]>>()
  const active = new Map<string, number>() // rule -> start line
  const sorted = [...directives].sort((a, b) => a.line - b.line)
  const close = (rule: string, endLine: number): void => {
    const start = active.get(rule)
    if (start === undefined) return
    active.delete(rule)
    const list = intervals.get(rule) ?? []
    list.push([start, endLine])
    intervals.set(rule, list)
  }
  for (const directive of sorted) {
    if (directive.kind === 'disable-line' || directive.kind === 'disable-next-line') continue
    const targets = directive.rules.length ? directive.rules : ['*']
    if (directive.kind === 'disable') {
      for (const rule of targets) {
        if (!active.has(rule)) active.set(rule, directive.line)
      }
    } else if (directive.kind === 'enable') {
      for (const rule of targets) close(rule, directive.line)
    }
  }
  for (const rule of [...active.keys()]) close(rule, Number.POSITIVE_INFINITY)
  return { intervals }
}

export function inlineDisabled(state: InlineState, ruleId: string, line: number): boolean {
  const check = (rule: string): boolean => {
    const list = state.intervals.get(rule)
    if (!list) return false
    return list.some(([from, to]) => line >= from && line < to)
  }
  return check('*') || check(ruleId)
}

export function lineDisabled(directives: InlineIgnoreDirective[], ruleId: string, line: number): boolean {
  for (const directive of directives) {
    if (directive.kind === 'disable-line') {
      if (directive.line !== line) continue
      if (!directive.rules.length || directive.rules.includes(ruleId)) return true
    }
    if (directive.kind === 'disable-next-line') {
      if (directive.line + 1 !== line) continue
      if (!directive.rules.length || directive.rules.includes(ruleId)) return true
    }
  }
  return false
}

/** Element-attribute ignores: `data-impeccable-disable` applies to the element and its subtree. */
export function elementAttributeDisabled(node: ElementNode, ruleId: string): boolean {
  const value = node.attrs['data-impeccable-disable']
  if (value === null || value === undefined) return false
  if (value.trim() === '') return true
  const rules = value.split(/[\s,]+/).map((r) => r.trim().toLowerCase()).filter(Boolean)
  return rules.includes(ruleId)
}

export function subtreeAttributeDisabled(node: ElementNode, ruleId: string): boolean {
  let cur: ElementNode | null = node
  while (cur && cur.tag !== '#root') {
    if (elementAttributeDisabled(cur, ruleId)) return true
    cur = cur.parent
  }
  return false
}

export function globToRegExp(glob: string): RegExp {
  let pattern = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        pattern += '.*'
        i++
      } else {
        pattern += '[^/]*'
      }
    } else if (ch === '?') {
      pattern += '[^/]'
    } else {
      pattern += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${pattern}$`)
}

function matchesAnyGlob(fileName: string, globs: string[]): boolean {
  const normalized = fileName.replace(/\\/g, '/')
  return globs.some((g) => {
    const pattern = g.replace(/\\/g, '/')
    if (globToRegExp(pattern).test(normalized)) return true
    // Also allow basename matches for loose globs like 'src/legacy/**'.
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3)
      return normalized.startsWith(prefix)
    }
    return false
  })
}

export interface IgnoreResolution {
  ruleIgnored: string[]
  inlineState: InlineState
  directives: InlineIgnoreDirective[]
}

export function resolveIgnores(
  doc: { comments: CommentNode[]; root: ElementNode },
  options: IgnoreOptions | undefined,
): IgnoreResolution {
  const opts = options ?? {}
  const inline = opts.inline !== false
  const directives = inline ? parseInlineDirectives(doc.comments) : []
  const inlineState = buildInlineState(directives)
  const ruleIgnored = new Set<string>()
  for (const rule of opts.rules ?? []) ruleIgnored.add(rule.toLowerCase())
  // A file-level ignore glob skips every rule.
  if (opts.files?.length) {
    // Resolved by the caller against the actual file name via isFileIgnored.
  }
  return { ruleIgnored: [...ruleIgnored], inlineState, directives }
}

export function isFileIgnored(fileName: string | undefined, options: IgnoreOptions | undefined): boolean {
  if (!fileName || !options?.files?.length) return false
  return matchesAnyGlob(fileName, options.files)
}

export function findingIgnored(
  finding: Finding,
  resolution: IgnoreResolution,
  options: IgnoreOptions | undefined,
): boolean {
  const opts = options ?? {}
  const rule = finding.rule.toLowerCase()
  if (resolution.ruleIgnored.includes(rule)) return true
  if (inlineDisabled(resolution.inlineState, rule, finding.line)) return true
  if (lineDisabled(resolution.directives, rule, finding.line)) return true
  // Value ignores: 'rule:value' or bare value.
  for (const entry of opts.values ?? []) {
    const idx = entry.indexOf(':')
    if (idx === -1) {
      if (finding.value && finding.value.toLowerCase() === entry.toLowerCase()) return true
    } else {
      const rulePart = entry.slice(0, idx).trim().toLowerCase()
      const valuePart = entry.slice(idx + 1).trim().toLowerCase()
      if (rulePart === rule && finding.value && finding.value.toLowerCase() === valuePart) return true
    }
  }
  return false
}

export function elementIgnored(node: ElementNode, ruleId: string): boolean {
  return subtreeAttributeDisabled(node, ruleId)
}

export function collectElementIgnoreState(doc: { root: ElementNode }): Map<string, Set<string>> {
  // Walk once, precomputing per-path ignore sets so rules can ask cheaply.
  const map = new Map<string, Set<string>>()
  walkElements(doc.root, (el) => {
    const value = el.attrs['data-impeccable-disable']
    if (value === null || value === undefined) return
    const rules = value.trim() === '' ? ['*'] : value.split(/[\s,]+/).map((r) => r.trim().toLowerCase()).filter(Boolean)
    const stack: ElementNode[] = [el]
    while (stack.length) {
      const cur = stack.pop()!
      if (cur.tag === '#root') continue
      const key = `${cur.tag}:${cur.line}` // stable-ish per parse
      const set = map.get(key) ?? new Set<string>()
      for (const r of rules) set.add(r)
      map.set(key, set)
      stack.push(...cur.children)
    }
  })
  return map
}
