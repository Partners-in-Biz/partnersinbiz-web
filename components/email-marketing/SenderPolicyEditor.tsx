'use client'

import { useEffect, useState } from 'react'

type Policy = {
  id: string
  name: string
  strategy: string
  purpose: string
  enabled: boolean
}

function unwrapPolicies(body: unknown): Policy[] {
  if (!body || typeof body !== 'object') return []
  const outer = body as { data?: { policies?: Policy[] }; policies?: Policy[] }
  const policies = outer.data?.policies ?? outer.policies ?? []
  return policies
}

export function SenderPolicyEditor({ orgId, value, onChange, disabled = false }: {
  orgId: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const enabledPolicies = policies.filter((policy) => policy.enabled)
  const selectedPolicy = value ? policies.find((policy) => policy.id === value) : undefined
  const selectedUnavailable = state === 'ready' && !!value && (!selectedPolicy || !selectedPolicy.enabled)
  const selectedAvailabilityUnknown = state === 'error' && !!value
  const showPreservedSelection = selectedUnavailable || selectedAvailabilityUnknown

  useEffect(() => {
    let cancelled = false
    setState('loading')
    fetch(`/api/v1/email-marketing/sender-policies?orgId=${encodeURIComponent(orgId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('request failed')
        return response.json()
      })
      .then((body) => {
        if (!cancelled) {
          setPolicies(unwrapPolicies(body))
          setState('ready')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPolicies([])
          setState('error')
        }
      })
    return () => { cancelled = true }
  }, [orgId])

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="sc-tiny !text-[10px]">Delivery identity</legend>
      <label className="block text-xs text-[var(--color-pib-text-muted)]" htmlFor="campaign-sender-policy">
        Sender policy
      </label>
      <select
        id="campaign-sender-policy"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-10 w-full rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] px-3 text-sm text-[var(--color-pib-text)]"
       aria-label="Input">
        <option value="">Organisation default</option>
        {showPreservedSelection ? (
          <option value={value}>
            {selectedPolicy?.name ?? `Saved policy ${value}`} · {selectedAvailabilityUnknown ? 'availability unknown' : 'unavailable'}
          </option>
        ) : null}
        {enabledPolicies.map((policy) => (
          <option key={policy.id} value={policy.id}>{policy.name} · {policy.strategy.replaceAll('_', ' ')}</option>
        ))}
      </select>
      {state === 'loading' ? <p role="status" className="text-xs text-[var(--color-pib-text-muted)]">Loading sender policies…</p> : null}
      {state === 'error' ? <p role="alert" className="text-xs text-[var(--sc-ink-soft)]">Sender policy availability could not be verified. The saved selection is preserved; retry before changing delivery identity.</p> : null}
      {selectedUnavailable ? <p role="alert" className="text-xs text-[var(--sc-ink-soft)]">The saved sender policy is unavailable. Choose an enabled policy or deliberately switch to Organisation default before saving.</p> : null}
      {state === 'ready' && enabledPolicies.length === 0 ? <p className="text-xs text-[var(--sc-ink-soft)]">No enabled sender policies are configured. Delivery will use the established organisation default.</p> : null}
      <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">
        Reply routing is assigned by the campaign delivery workflow. A selectable reply policy will appear when the organisation reply-policy registry is available.
      </p>
    </fieldset>
  )
}
