'use client'
// app/(admin)/admin/org/[slug]/ads/conversion-actions/ConversionActionsClient.tsx
// Sub-3a Phase 6 Batch 3 F  -  client component: list + delete + form toggle.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AdConversionAction } from '@/lib/ads/types'
import { ConversionActionForm } from '@/components/ads/google/ConversionActionForm'

interface Props {
  orgSlug: string
  orgId: string
  initialActions: AdConversionAction[]
}

const PLATFORM_TINT: Record<string, string> = {
  google: 'pib-pill-info',
  meta: 'pib-pill-blue',
}

export function ConversionActionsClient({ orgSlug, orgId, initialActions }: Props) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function deleteAction(id: string) {
    setDeleting(id)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/v1/ads/conversion-actions/${id}`, {
        method: 'DELETE',
        headers: { 'X-Org-Id': orgId },
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? `HTTP ${res.status}`)
      router.refresh()
    } catch (e) {
      setDeleteError((e as Error).message)
    } finally {
      setDeleting(null)
    }
  }

  function handleCreated() {
    setShowForm(false)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          {initialActions.length}{' '}
          {initialActions.length === 1 ? 'conversion action' : 'conversion actions'}
        </p>
        <button
          type="button"
          className="btn-pib-primary text-sm"
          onClick={() => setShowForm((v) => !v)}
          aria-label={showForm ? 'Cancel' : 'New conversion action'}
        >
          {showForm ? 'Cancel' : 'New conversion action'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="pib-card">
          <h2 className="pib-label mb-4">New conversion action</h2>
          <ConversionActionForm orgSlug={orgSlug} orgId={orgId} onCreated={handleCreated} />
        </div>
      )}

      {/* Error */}
      {deleteError && (
        <p className="pib-pill pib-pill-danger px-3 py-2 text-sm normal-case tracking-normal">
          {deleteError}
        </p>
      )}

      {/* List */}
      {initialActions.length === 0 ? (
        <div className="pib-empty-state">
          
          <p className="pib-empty-state-description">No conversion actions yet.</p>
          {!showForm && (
            <button
              type="button"
              className="mt-3 text-sm text-[var(--st-danger)] hover:underline"
              onClick={() => setShowForm(true)}
            >
              Create an admin conversion action →
            </button>
          )}
        </div>
      ) : (
        <div className="pib-surface pib-surface-list">
          <ul className="divide-y divide-[var(--color-pib-line)]">
            {initialActions.map((action) => (
              <li
                key={action.id}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate text-[var(--color-pib-text)]">{action.name}</span>
                    <span
                      className={`pib-pill shrink-0 ${PLATFORM_TINT[action.platform] ?? PLATFORM_TINT.google}`}
                    >
                      {action.platform}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">
                    {action.category.replace(/_/g, ' ')}
                    {action.countingType === 'MANY_PER_CLICK' && ' · many/click'}
                    {action.valueSettings?.defaultValue != null &&
                      ` · ${action.valueSettings.defaultCurrencyCode ?? ''} ${action.valueSettings.defaultValue}`}
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-error)] transition-colors disabled:opacity-40"
                  onClick={() => deleteAction(action.id)}
                  disabled={deleting === action.id}
                  aria-label={`Delete ${action.name}`}
                >
                  {deleting === action.id ? 'Deleting…' : 'Delete'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
