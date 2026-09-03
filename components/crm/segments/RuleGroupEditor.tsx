'use client'

// US-055 - generic field/operator/value rule builder with nested AND/OR groups.
// Mirrors the RuleGroup / FieldRule shapes in lib/crm/segments.ts. The editor is
// fully controlled: it owns no persistence, just emits a sanitised-shape tree
// back to the parent which previews + saves it.

import { useCallback } from 'react'
import type { FieldRule, RuleGroup, RuleField, RuleOperator, RuleCombinator } from '@/lib/crm/segments'
import { Icon } from '@/components/studio'

type RuleNode = FieldRule | RuleGroup

function isGroup(node: RuleNode): node is RuleGroup {
  return Array.isArray((node as RuleGroup).rules)
}

// Field metadata drives the operator + input affordances.
type FieldKind = 'text' | 'number' | 'date' | 'tags' | 'enum'

interface FieldDef {
  field: RuleField
  label: string
  kind: FieldKind
  options?: string[]
}

const STAGE_OPTIONS = ['new', 'contacted', 'replied', 'demo', 'proposal', 'won', 'lost']
const TYPE_OPTIONS = ['lead', 'prospect', 'client', 'churned']
const SOURCE_OPTIONS = ['manual', 'form', 'import', 'outreach']

const FIELD_DEFS: FieldDef[] = [
  { field: 'name', label: 'Name', kind: 'text' },
  { field: 'email', label: 'Email', kind: 'text' },
  { field: 'company', label: 'Company', kind: 'text' },
  { field: 'website', label: 'Website', kind: 'text' },
  { field: 'phone', label: 'Phone', kind: 'text' },
  { field: 'jobTitle', label: 'Job title', kind: 'text' },
  { field: 'stage', label: 'Stage', kind: 'enum', options: STAGE_OPTIONS },
  { field: 'type', label: 'Type', kind: 'enum', options: TYPE_OPTIONS },
  { field: 'source', label: 'Source', kind: 'enum', options: SOURCE_OPTIONS },
  { field: 'tags', label: 'Tags', kind: 'tags' },
  { field: 'leadScore', label: 'Lead score', kind: 'number' },
  { field: 'icpScore', label: 'ICP score', kind: 'number' },
  { field: 'createdAt', label: 'Created date', kind: 'date' },
  { field: 'utmSource', label: 'UTM source', kind: 'text' },
  { field: 'utmMedium', label: 'UTM medium', kind: 'text' },
  { field: 'utmCampaign', label: 'UTM campaign', kind: 'text' },
  { field: 'utmTerm', label: 'UTM term', kind: 'text' },
  { field: 'utmContent', label: 'UTM content', kind: 'text' },
]

const FIELD_MAP = new Map(FIELD_DEFS.map((f) => [f.field, f]))

const OPERATOR_LABELS: Record<RuleOperator, string> = {
  equals: 'equals',
  'not-equals': 'does not equal',
  contains: 'contains',
  'not-contains': 'does not contain',
  'starts-with': 'starts with',
  'ends-with': 'ends with',
  gt: 'greater than',
  gte: 'greater or equal',
  lt: 'less than',
  lte: 'less or equal',
  in: 'is any of',
  'not-in': 'is none of',
  'is-empty': 'is empty',
  'is-not-empty': 'is not empty',
}

const TEXT_OPERATORS: RuleOperator[] = [
  'equals',
  'not-equals',
  'contains',
  'not-contains',
  'starts-with',
  'ends-with',
  'in',
  'not-in',
  'is-empty',
  'is-not-empty',
]
const ENUM_OPERATORS: RuleOperator[] = ['equals', 'not-equals', 'in', 'not-in', 'is-empty', 'is-not-empty']
const NUMBER_OPERATORS: RuleOperator[] = [
  'equals',
  'not-equals',
  'gt',
  'gte',
  'lt',
  'lte',
  'is-empty',
  'is-not-empty',
]
const DATE_OPERATORS: RuleOperator[] = ['gt', 'gte', 'lt', 'lte', 'is-empty', 'is-not-empty']
const TAGS_OPERATORS: RuleOperator[] = ['contains', 'not-contains', 'in', 'not-in', 'is-empty', 'is-not-empty']

function operatorsForKind(kind: FieldKind): RuleOperator[] {
  switch (kind) {
    case 'number':
      return NUMBER_OPERATORS
    case 'date':
      return DATE_OPERATORS
    case 'tags':
      return TAGS_OPERATORS
    case 'enum':
      return ENUM_OPERATORS
    default:
      return TEXT_OPERATORS
  }
}

const VALUELESS: ReadonlySet<RuleOperator> = new Set(['is-empty', 'is-not-empty'])
const MULTI_VALUE: ReadonlySet<RuleOperator> = new Set(['in', 'not-in'])

export function emptyRuleGroup(): RuleGroup {
  return { combinator: 'AND', rules: [] }
}

function emptyFieldRule(): FieldRule {
  return { field: 'email', operator: 'contains', value: '' }
}

interface RuleGroupEditorProps {
  group: RuleGroup
  onChange: (group: RuleGroup) => void
  /** internal nesting depth - caps the UI to keep it sane */
  depth?: number
  onRemove?: () => void
}

export function RuleGroupEditor({ group, onChange, depth = 0, onRemove }: RuleGroupEditorProps) {
  const updateRuleAt = useCallback(
    (index: number, next: RuleNode) => {
      const rules = group.rules.slice()
      rules[index] = next
      onChange({ ...group, rules })
    },
    [group, onChange],
  )

  const removeRuleAt = useCallback(
    (index: number) => {
      const rules = group.rules.slice()
      rules.splice(index, 1)
      onChange({ ...group, rules })
    },
    [group, onChange],
  )

  const addRule = useCallback(() => {
    onChange({ ...group, rules: [...group.rules, emptyFieldRule()] })
  }, [group, onChange])

  const addGroup = useCallback(() => {
    onChange({ ...group, rules: [...group.rules, emptyRuleGroup()] })
  }, [group, onChange])

  const setCombinator = useCallback(
    (combinator: RuleCombinator) => {
      onChange({ ...group, combinator })
    },
    [group, onChange],
  )

  return (
    <div
      className="space-y-2 rounded-md border border-[var(--color-card-border)] bg-black/10 p-2"
      data-depth={depth}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex items-center gap-1 rounded-md border border-[var(--color-card-border)] p-0.5">
          {(['AND', 'OR'] as RuleCombinator[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCombinator(c)}
              className={`rounded-md px-2.5 py-0.5 text-[11px] font-label uppercase tracking-[0.22em] transition ${
                group.combinator === c
                  ? 'bg-[var(--color-accent-v2)] text-black'
                  : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
              }`}
            >
              {c}
            </button>
          ))}
          <span className="px-2 text-[10px] text-[var(--color-pib-text-muted)]">
            {group.combinator === 'AND' ? 'match all' : 'match any'}
          </span>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="grid h-8 w-8 place-items-center rounded-md text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-red-300"
            aria-label="Remove group"
          >
            <Icon name="delete" className="text-[16px]" />
          </button>
        )}
      </div>

      {group.rules.length === 0 && (
        <p className="text-[11px] text-[var(--color-pib-text-muted)]">
          No conditions yet - add a rule below.
        </p>
      )}

      <div className="space-y-2">
        {group.rules.map((node, i) =>
          isGroup(node) ? (
            <RuleGroupEditor
              key={i}
              group={node}
              depth={depth + 1}
              onChange={(g) => updateRuleAt(i, g)}
              onRemove={() => removeRuleAt(i)}
            />
          ) : (
            <FieldRuleRow
              key={i}
              rule={node}
              onChange={(r) => updateRuleAt(i, r)}
              onRemove={() => removeRuleAt(i)}
            />
          ),
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={addRule}
          className="flex h-8 items-center gap-1 rounded-md border border-[var(--color-card-border)] px-2.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
        >
          <Icon name="add" className="text-[16px]" />
          Add rule
        </button>
        {depth < 4 && (
          <button
            type="button"
            onClick={addGroup}
            className="flex h-8 items-center gap-1 rounded-md border border-[var(--color-card-border)] px-2.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
          >
            <Icon name="account_tree" className="text-[16px]" />
            Add group
          </button>
        )}
      </div>
    </div>
  )
}

interface FieldRuleRowProps {
  rule: FieldRule
  onChange: (rule: FieldRule) => void
  onRemove: () => void
}

function FieldRuleRow({ rule, onChange, onRemove }: FieldRuleRowProps) {
  const def = FIELD_MAP.get(rule.field) ?? FIELD_DEFS[0]
  const operators = operatorsForKind(def.kind)
  const needsValue = !VALUELESS.has(rule.operator)
  const isMulti = MULTI_VALUE.has(rule.operator)

  function changeField(nextField: RuleField) {
    const nextDef = FIELD_MAP.get(nextField) ?? FIELD_DEFS[0]
    const nextOps = operatorsForKind(nextDef.kind)
    const nextOp = nextOps.includes(rule.operator) ? rule.operator : nextOps[0]
    onChange({ field: nextField, operator: nextOp, value: '' })
  }

  function changeOperator(nextOp: RuleOperator) {
    const next: FieldRule = { ...rule, operator: nextOp }
    if (VALUELESS.has(nextOp)) {
      delete next.value
    } else if (next.value === undefined) {
      next.value = ''
    }
    onChange(next)
  }

  function changeValue(value: string) {
    if (isMulti) {
      const arr = value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
      onChange({ ...rule, value: def.kind === 'number' ? arr.map((v) => Number(v)) : arr })
    } else if (def.kind === 'number') {
      onChange({ ...rule, value: value === '' ? '' : Number(value) })
    } else {
      onChange({ ...rule, value })
    }
  }

  const valueAsString = Array.isArray(rule.value)
    ? rule.value.join(', ')
    : rule.value === undefined || rule.value === null
      ? ''
      : String(rule.value)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={rule.field}
        onChange={(e) => changeField(e.target.value as RuleField)}
        className="h-8 min-w-[8rem] rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)] outline-none transition focus:border-[var(--color-accent-v2)]"
        aria-label="Field"
      >
        {FIELD_DEFS.map((f) => (
          <option key={f.field} value={f.field} className="bg-black">
            {f.label}
          </option>
        ))}
      </select>

      <select
        value={rule.operator}
        onChange={(e) => changeOperator(e.target.value as RuleOperator)}
        className="h-8 min-w-[9rem] rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)] outline-none transition focus:border-[var(--color-accent-v2)]"
        aria-label="Operator"
      >
        {operators.map((op) => (
          <option key={op} value={op} className="bg-black">
            {OPERATOR_LABELS[op]}
          </option>
        ))}
      </select>

      {needsValue &&
        (def.kind === 'enum' && !isMulti ? (
          <select
            value={valueAsString}
            onChange={(e) => changeValue(e.target.value)}
            className="h-8 min-w-[8rem] rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)] outline-none transition focus:border-[var(--color-accent-v2)]"
            aria-label="Value"
          >
            <option value="" className="bg-black">
 - select - 
            </option>
            {(def.options ?? []).map((o) => (
              <option key={o} value={o} className="bg-black">
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={valueAsString}
            onChange={(e) => changeValue(e.target.value)}
            type={def.kind === 'number' && !isMulti ? 'number' : def.kind === 'date' && !isMulti ? 'date' : 'text'}
            placeholder={isMulti ? 'comma, separated, values' : def.kind === 'tags' ? 'tag' : 'value'}
            className="h-8 min-w-[10rem] flex-1 rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)] outline-none transition focus:border-[var(--color-accent-v2)]"
            aria-label="Value"
          />
        ))}

      <button
        type="button"
        onClick={onRemove}
        className="ml-auto grid h-8 w-8 place-items-center rounded-md text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-red-300"
        aria-label="Remove rule"
      >
        <Icon name="close" className="text-[16px]" />
      </button>
    </div>
  )
}
