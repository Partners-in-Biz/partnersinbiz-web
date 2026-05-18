'use client'

import { useState, useEffect } from 'react'
import type {
  AutomationRule,
  AutomationAction,
  AutomationTrigger,
  ActionType,
  TriggerEvent,
} from '@/lib/automations/types'

// ── SequencePickerInline ───────────────────────────────────────────────────────

function SequencePickerInline({ value, onChange }: { value: string; onChange: (id: string, name: string) => void }) {
  const [sequences, setSequences] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    fetch('/api/v1/crm/sequences')
      .then(r => r.json())
      .then(b => setSequences(b.data?.sequences ?? b.data ?? []))
      .catch(() => {})
  }, [])
  return (
    <select
      value={value}
      onChange={e => {
        const seq = sequences.find(s => s.id === e.target.value)
        onChange(e.target.value, seq?.name ?? '')
      }}
      className="pib-input text-sm"
    >
      <option value="">Select sequence…</option>
      {sequences.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  )
}

// ── ActionRow ─────────────────────────────────────────────────────────────────

function ActionRow({
  action,
  onChange,
  onRemove,
}: {
  action: AutomationAction
  onChange: (a: AutomationAction) => void
  onRemove: () => void
}) {
  return (
    <div className="bento-card !p-4 mb-2 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <select
          value={action.type}
          onChange={(e) => onChange({ type: e.target.value as ActionType })}
          className="flex-1 text-sm px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
        >
          <option value="send_email">Send email</option>
          <option value="send_notification">Send notification</option>
          <option value="assign_owner">Assign owner</option>
          <option value="dispatch_webhook">Dispatch webhook</option>
          <option value="enroll_in_sequence">Enroll in sequence</option>
        </select>
        <button
          type="button"
          onClick={onRemove}
          className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-red-400 transition-colors shrink-0"
          aria-label="Remove action"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {action.type === 'send_email' && (
        <>
          <select
            value={action.emailTo ?? 'contact'}
            onChange={(e) => onChange({ ...action, emailTo: e.target.value as 'contact' | 'owner' })}
            className="text-sm px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
          >
            <option value="contact">Contact</option>
            <option value="owner">Deal / Contact owner</option>
          </select>
          <input
            type="text"
            placeholder="Subject"
            value={action.emailSubject ?? ''}
            onChange={(e) => onChange({ ...action, emailSubject: e.target.value })}
            className="text-sm px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] placeholder-[var(--color-pib-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
          />
          <textarea
            rows={4}
            placeholder="Email body (HTML supported)"
            value={action.emailBody ?? ''}
            onChange={(e) => onChange({ ...action, emailBody: e.target.value })}
            className="text-sm px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] placeholder-[var(--color-pib-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)] resize-y"
          />
        </>
      )}

      {action.type === 'send_notification' && (
        <>
          <select
            value={action.notificationTo ?? 'owner'}
            onChange={(e) =>
              onChange({ ...action, notificationTo: e.target.value as 'owner' | 'all_admins' })
            }
            className="text-sm px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
          >
            <option value="owner">Owner</option>
            <option value="all_admins">All admins</option>
          </select>
          <input
            type="text"
            placeholder="Notification message"
            value={action.notificationMessage ?? ''}
            onChange={(e) => onChange({ ...action, notificationMessage: e.target.value })}
            className="text-sm px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] placeholder-[var(--color-pib-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
          />
        </>
      )}

      {action.type === 'assign_owner' && (
        <input
          type="text"
          placeholder="Owner UID"
          value={action.ownerUid ?? ''}
          onChange={(e) => onChange({ ...action, ownerUid: e.target.value })}
          className="text-sm px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] placeholder-[var(--color-pib-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
        />
      )}

      {action.type === 'dispatch_webhook' && (
        <input
          type="url"
          placeholder="https://example.com/webhook"
          value={action.webhookUrl ?? ''}
          onChange={(e) => onChange({ ...action, webhookUrl: e.target.value })}
          className="text-sm px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] placeholder-[var(--color-pib-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
        />
      )}

      {action.type === 'enroll_in_sequence' && (
        <SequencePickerInline
          value={action.sequenceId ?? ''}
          onChange={(id, name) => onChange({ ...action, sequenceId: id, sequenceName: name })}
        />
      )}
    </div>
  )
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  initial?: Partial<AutomationRule>
  onSave: (rule: AutomationRule) => void
  onCancel: () => void
}

// ── AutomationRuleForm ─────────────────────────────────────────────────────────

export function AutomationRuleForm({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    initial?.trigger ?? { event: 'deal.created' }
  )
  const [delayMode, setDelayMode] = useState<'immediate' | 'delayed'>(
    initial?.delayMinutes ? 'delayed' : 'immediate'
  )
  const [delayValue, setDelayValue] = useState(initial?.delayMinutes ?? 60)
  const [delayUnit, setDelayUnit] = useState<'minutes' | 'hours' | 'days'>('hours')
  const [actions, setActions] = useState<AutomationAction[]>(initial?.actions ?? [])
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  const isEdit = Boolean(initial?.id)

  function computeDelayMinutes(): number | undefined {
    if (delayMode === 'immediate') return undefined
    const multipliers: Record<'minutes' | 'hours' | 'days', number> = {
      minutes: 1,
      hours: 60,
      days: 1440,
    }
    return delayValue * multipliers[delayUnit]
  }

  function addAction() {
    setActions((prev) => [...prev, { type: 'send_notification' }])
  }

  function updateAction(index: number, updated: AutomationAction) {
    setActions((prev) => prev.map((a, i) => (i === index ? updated : a)))
  }

  function removeAction(index: number) {
    setActions((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit() {
    setValidationError(null)
    setSaveError(null)

    if (!name.trim()) {
      setValidationError('Rule name is required.')
      return
    }
    if (actions.length === 0) {
      setValidationError('Add at least one action.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        enabled,
        trigger,
        actions,
        delayMinutes: computeDelayMinutes(),
      }

      const url = isEdit
        ? `/api/v1/crm/automations/${initial!.id}`
        : '/api/v1/crm/automations'
      const method = isEdit ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)

      const returnedRule: AutomationRule = body.data ?? body
      onSave(returnedRule)
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Name ── */}
      <div className="bento-card !p-6">
        <p className="eyebrow !text-[10px] mb-4">Rule name</p>
        <input
          type="text"
          placeholder="e.g. Welcome email on contact created"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full text-sm px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] placeholder-[var(--color-pib-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
        />
      </div>

      {/* ── Trigger ── */}
      <div className="bento-card !p-6">
        <p className="eyebrow !text-[10px] mb-4">Trigger</p>
        <select
          value={trigger.event}
          onChange={(e) =>
            setTrigger({ event: e.target.value as TriggerEvent })
          }
          className="w-full text-sm px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
        >
          <option value="deal.created">Deal created</option>
          <option value="deal.stage_changed">Deal stage changed</option>
          <option value="deal.won">Deal won</option>
          <option value="deal.lost">Deal lost</option>
          <option value="contact.created">Contact created</option>
          <option value="contact.lifecycle_changed">Contact lifecycle changed</option>
        </select>

        {trigger.event === 'deal.stage_changed' && (
          <div className="mt-3">
            <label className="block text-xs text-[var(--color-pib-text-muted)] mb-1">
              Filter by stage ID (optional)
            </label>
            <input
              type="text"
              placeholder="Leave blank to fire on any stage change"
              value={trigger.toStageId ?? ''}
              onChange={(e) =>
                setTrigger((t) => ({
                  ...t,
                  toStageId: e.target.value || undefined,
                }))
              }
              className="w-full text-sm px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] placeholder-[var(--color-pib-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
            />
          </div>
        )}
      </div>

      {/* ── Timing ── */}
      <div className="bento-card !p-6">
        <p className="eyebrow !text-[10px] mb-4">Timing</p>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="delayMode"
              checked={delayMode === 'immediate'}
              onChange={() => setDelayMode('immediate')}
              className="accent-[var(--color-pib-accent)]"
            />
            <span className="text-sm">Immediately</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="delayMode"
              checked={delayMode === 'delayed'}
              onChange={() => setDelayMode('delayed')}
              className="accent-[var(--color-pib-accent)]"
            />
            <span className="text-sm">After delay</span>
          </label>
        </div>

        {delayMode === 'delayed' && (
          <div className="flex items-center gap-2 mt-3">
            <input
              type="number"
              min={1}
              value={delayValue}
              onChange={(e) => setDelayValue(Math.max(1, Number(e.target.value)))}
              className="w-20 text-sm px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
            />
            <select
              value={delayUnit}
              onChange={(e) => setDelayUnit(e.target.value as 'minutes' | 'hours' | 'days')}
              className="text-sm px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
            >
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      <div className="bento-card !p-6">
        <p className="eyebrow !text-[10px] mb-4">Actions</p>

        {actions.length === 0 && (
          <p className="text-sm text-[var(--color-pib-text-muted)] mb-3">
            No actions yet. Add one below.
          </p>
        )}

        {actions.map((action, i) => (
          <ActionRow
            key={i}
            action={action}
            onChange={(updated) => updateAction(i, updated)}
            onRemove={() => removeAction(i)}
          />
        ))}

        <button
          type="button"
          onClick={addAction}
          className="cursor-pointer btn-pib-secondary text-sm flex items-center gap-1.5 mt-3"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          Add action
        </button>
      </div>

      {/* ── Enabled toggle ── */}
      <div className="bento-card !p-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Enabled</p>
          <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">
            Disabled rules are saved but will not fire.
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <div className="w-10 h-6 bg-[var(--color-pib-line-strong)] peer-checked:bg-[var(--color-pib-accent)] rounded-full transition-colors" />
          <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
        </label>
      </div>

      {/* ── Validation / save errors ── */}
      {(validationError ?? saveError) && (
        <p className="text-sm text-red-400 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">error</span>
          {validationError ?? saveError}
        </p>
      )}

      {/* ── Footer buttons ── */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="cursor-pointer btn-pib-accent flex items-center gap-1.5 text-sm disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[16px]">save</span>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create rule'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="cursor-pointer btn-pib-secondary text-sm disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
