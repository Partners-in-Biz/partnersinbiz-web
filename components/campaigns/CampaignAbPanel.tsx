'use client'

// components/campaigns/CampaignAbPanel.tsx
//
// Self-contained A/B panel for the email campaign editor. Loads + saves the
// campaign's AbConfig via /api/v1/campaigns/[id]/ab and declares a winner via
// /api/v1/campaigns/[id]/ab/declare-winner. Wraps the shared AbTestingPanel.
//
// Usage (in EmailCampaignEditor.tsx):
//   <CampaignAbPanel campaignId={campaign.id} orgId={orgId} />
//
// It manages its own load/save lifecycle so the host editor doesn't need to
// thread the AbConfig through its own form state.

import { useCallback, useEffect, useState } from 'react'
import AbTestingPanel from '@/components/email/AbTestingPanel'
import type { AbConfig } from '@/lib/ab-testing/types'
import { EMPTY_AB } from '@/lib/ab-testing/types'

interface Props {
  campaignId: string
  /** Optional org scope for platform-staff acting on a client org. */
  orgId?: string | null
  /** Disable editing entirely (e.g. campaign already completed). */
  disabled?: boolean
}

function withOrg(path: string, orgId?: string | null): string {
  if (!orgId) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}orgId=${encodeURIComponent(orgId)}`
}

function unwrap<T>(body: { success?: boolean; data?: T } & Record<string, unknown>): T {
  return (body.data ?? body) as T
}

export default function CampaignAbPanel({ campaignId, orgId, disabled }: Props) {
  const [ab, setAb] = useState<AbConfig>(EMPTY_AB)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(withOrg(`/api/v1/campaigns/${campaignId}/ab`, orgId))
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        if (body.success === false) {
          setError(body.error ?? 'Failed to load A/B config')
          return
        }
        const data = unwrap<{ ab: AbConfig }>(body)
        setAb(data.ab ?? EMPTY_AB)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load A/B config')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [campaignId, orgId])

  const handleChange = useCallback((next: AbConfig) => {
    setAb(next)
    setDirty(true)
    setNotice(null)
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(withOrg(`/api/v1/campaigns/${campaignId}/ab`, orgId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ab }),
      })
      const body = await res.json()
      if (!res.ok || body.success === false) {
        throw new Error(body.error ?? 'Failed to save A/B config')
      }
      const data = unwrap<{ ab: AbConfig }>(body)
      setAb(data.ab ?? ab)
      setDirty(false)
      setNotice('A/B configuration saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save A/B config')
    } finally {
      setSaving(false)
    }
  }, [ab, campaignId, orgId])

  const handleDeclareWinner = useCallback(
    async (variantId: string) => {
      setSaving(true)
      setError(null)
      setNotice(null)
      try {
        const res = await fetch(
          withOrg(`/api/v1/campaigns/${campaignId}/ab/declare-winner`, orgId),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ variantId }),
          },
        )
        const body = await res.json()
        if (!res.ok || body.success === false) {
          throw new Error(body.error ?? 'Failed to declare winner')
        }
        const data = unwrap<{ ab: AbConfig }>(body)
        setAb(data.ab ?? ab)
        setNotice(`Winner ${variantId.toUpperCase()} declared — it will fan out to the remaining audience shortly.`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to declare winner')
      } finally {
        setSaving(false)
      }
    },
    [ab, campaignId, orgId],
  )

  if (loading) {
    return <div className="h-40 rounded-xl bg-white/[0.04] animate-pulse" />
  }

  return (
    <div className="space-y-3">
      <AbTestingPanel
        value={ab}
        onChange={handleChange}
        disabled={disabled || saving}
        onDeclareWinner={handleDeclareWinner}
      />

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          {notice}
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        {dirty && <span className="text-xs text-amber-300">Unsaved changes</span>}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || disabled || !dirty}
          className="rounded-md bg-amber-500/20 px-4 py-2 text-sm text-amber-100 hover:bg-amber-500/30 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save A/B settings'}
        </button>
      </div>
    </div>
  )
}
