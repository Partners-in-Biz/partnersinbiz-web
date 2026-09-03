'use client'

import { Icon } from '@/components/studio'
import { chatContextReferenceKey, type ChatContextReadModel, type ChatContextReference } from '@/lib/chat-context/types'
import type { ChatContextOption } from './ContextSelector'

const ICONS: Record<string, string> = {
  project: 'target', task: 'task_alt', contact: 'person', company: 'domain', product: 'inventory_2',
  document: 'description', research: 'science', social: 'campaign', campaign: 'ads_click', email: 'mail',
  support: 'support_agent', deal: 'handshake', invoice: 'receipt_long', quote: 'request_quote', property: 'apartment',
  seo_sprint: 'query_stats', workspace_folder: 'folder_open', workspace_artifact: 'draft', workspace_connection: 'link',
  workspace_broker_job: 'sync_alt', studio: 'auto_awesome', studio_artifact: 'collections', file: 'attach_file',
  report: 'analytics', calendar_event: 'calendar_month',
}

const TYPE_LABELS: Record<string, string> = {
  seo_sprint: 'SEO sprint', workspace_folder: 'Workspace folder', workspace_artifact: 'Workspace artifact',
  workspace_connection: 'Workspace connection', workspace_broker_job: 'Broker job', studio_artifact: 'Studio artifact',
  calendar_event: 'Calendar event',
}

function contextTypeLabel(kind: string) {
  return TYPE_LABELS[kind] ?? `${kind.charAt(0).toUpperCase()}${kind.slice(1).replaceAll('_', ' ')}`
}

interface ContextPickerDisclosureProps {
  pickerExpanded?: boolean
  pickerControls?: string
}

function contextPickerDisclosureProps({ pickerExpanded = false, pickerControls }: ContextPickerDisclosureProps) {
  return {
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': pickerExpanded,
    ...(pickerControls ? { 'aria-controls': pickerControls } : {}),
  }
}

export function EmptyContextStrip({ onAdd, pickerExpanded, pickerControls, className }: { onAdd: () => void; className?: string } & ContextPickerDisclosureProps) {
  return (
    <div data-testid="conversation-context-strip" role="toolbar" aria-label="Pinned conversation context" className={['flex min-h-11 shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-[var(--color-card-border)] bg-black/[0.08] px-3 py-1.5 [scrollbar-width:thin]', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        aria-label="Add conversation context"
        {...contextPickerDisclosureProps({ pickerExpanded, pickerControls })}
        onClick={onAdd}
        className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--color-card-border)] px-3 text-xs font-medium text-[var(--color-pib-text-muted)] outline-none transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:h-9"
      >
        <Icon name="add" className="text-[16px]" />
        Add context
      </button>
    </div>
  )
}

export function ContextStrip({ options, value, onChange, onRemove, onOpen, onAdd, model, pickerExpanded, pickerControls, className }: {
  options: ChatContextOption[]
  value: ChatContextReference
  onChange: (value: ChatContextReference) => void
  onRemove?: (value: ChatContextReference) => void
  onOpen: () => void
  onAdd?: () => void
  model?: ChatContextReadModel
  className?: string
} & ContextPickerDisclosureProps) {
  return (
    <div data-testid={model ? 'context-pulse' : 'conversation-context-strip'} role="toolbar" aria-label="Pinned conversation context" className={['flex min-h-11 shrink-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap border-b border-[var(--color-card-border)] bg-black/[0.08] px-3 py-1.5 [scrollbar-width:thin]', className].filter(Boolean).join(' ')}>
      {options.map((option) => {
        const active = chatContextReferenceKey(option) === chatContextReferenceKey(value)
        return (
          <span key={chatContextReferenceKey(option)} className={`group/context inline-flex h-11 shrink-0 items-center overflow-hidden rounded-lg border transition-colors xl:h-9 ${active ? 'border-primary/45 bg-primary/12 text-[var(--color-pib-text)]' : 'border-[var(--color-card-border)] bg-white/[0.035] text-[var(--color-pib-text-muted)] hover:bg-white/[0.07] hover:text-[var(--color-pib-text)]'}`}>
            <button
              type="button"
              aria-label={`Open ${option.label} context`}
              aria-pressed={active}
              onClick={() => { onChange({ kind: option.kind, id: option.id, ...(option.projectId ? { projectId: option.projectId } : {}) }); onOpen() }}
              className="inline-flex h-11 min-w-0 items-center gap-1.5 px-2.5 text-[11px] font-medium xl:h-9"
            >
              <Icon name={ICONS[option.kind] ?? 'category'} className={`text-[15px] ${active ? 'text-primary' : ''}`} />
              <span className="flex min-w-0 flex-col items-start leading-none">
                <span className="hidden text-[8px] font-label uppercase tracking-[0.12em] text-[var(--color-pib-text-muted)] xl:inline">{contextTypeLabel(option.kind)}</span>
                <span className="max-w-[190px] truncate leading-4">{option.label}</span>
              </span>
              {active && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-[4px] bg-emerald-400" />}
            </button>
            {onRemove && (
              <button type="button" aria-label={`Remove ${option.label} context`} onClick={() => onRemove(option)} className="grid h-11 w-11 shrink-0 place-items-center border-l border-white/[0.06] text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] xl:h-9 xl:w-8">
                <Icon name="close" className="text-[14px]" />
              </button>
            )}
          </span>
        )
      })}
      {model?.freshness?.mode === 'live' && (
        <span
          aria-label={`Live data from ${model.freshness.source}`}
          title={`Live data from ${model.freshness.source}. Refreshes every ${Math.round(model.freshness.refreshIntervalMs / 1000)} seconds.`}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[4px] border border-emerald-400/25 bg-emerald-500/[0.07] px-2.5 text-[10px] font-medium text-emerald-200"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-[4px] bg-emerald-400" />
          Live
        </span>
      )}
      {model?.pulse.progress && <span className="inline-flex h-8 shrink-0 items-center rounded-[4px] border border-emerald-400/20 bg-emerald-500/5 px-2.5 text-[10px] font-medium text-emerald-200">{model.pulse.progress.complete}/{model.pulse.progress.total} complete</span>}
      <button type="button" aria-label="Open context dock" onClick={onOpen} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-[var(--color-card-border)] bg-white/[0.035] text-[var(--color-pib-text-muted)] outline-none hover:bg-white/[0.07] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:h-9 xl:w-9">
        <Icon name="view_sidebar" className="text-[16px]" />
      </button>
      <button type="button" aria-label="Add conversation context" {...contextPickerDisclosureProps({ pickerExpanded, pickerControls })} onClick={onAdd} disabled={!onAdd} className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--color-card-border)] px-3 text-xs font-medium text-[var(--color-pib-text-muted)] outline-none hover:bg-white/[0.05] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-default disabled:opacity-50 xl:h-9">
        <Icon name="add" className="text-[16px]" />
        Add context
      </button>
    </div>
  )
}
