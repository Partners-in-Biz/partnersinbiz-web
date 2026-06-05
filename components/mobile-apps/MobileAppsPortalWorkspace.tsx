'use client'

import { useEffect, useState } from 'react'
import type { MobileAppRecord } from '@/lib/mobile-apps/types'
import { MobileAppList } from '@/components/mobile-apps/MobileAppList'
import { MobileAppsWorkspaceShell } from '@/components/mobile-apps/MobileAppsWorkspaceShell'

export function MobileAppsPortalWorkspace() {
  const [apps, setApps] = useState<MobileAppRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [clientNotes, setClientNotes] = useState('')
  const [clientFeedback, setClientFeedback] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    const res = await fetch('/api/v1/portal/mobile-apps')
    const body = await res.json().catch(() => ({}))
    setApps(Array.isArray(body.data?.apps) ? body.data.apps : [])
    setLoading(false)
  }

  useEffect(() => {
    async function loadInitial() {
      await load()
    }
    loadInitial()
  }, [])

  function startFeedback(app: MobileAppRecord) {
    setEditingId(app.id ?? null)
    setClientNotes(app.clientNotes ?? '')
    setClientFeedback(app.listing?.clientFeedback ?? '')
    setNotice('')
  }

  async function saveFeedback() {
    if (!editingId) return
    const res = await fetch('/api/v1/portal/mobile-apps', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editingId, clientNotes, clientFeedback }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setNotice(body.error ?? 'Could not save feedback')
      return
    }
    setEditingId(null)
    setNotice('Feedback saved for the PiB team.')
    await load()
  }

  return (
    <MobileAppsWorkspaceShell
      apps={apps}
      surface="portal"
      eyebrow="Digital presence"
      title="Mobile apps"
      description="Store links, listing copy, ratings, release notes and app tasks that need client review."
      notice={notice}
      loading={loading}
      className="p-4 sm:p-6 lg:p-8"
    >
      <MobileAppList
        apps={apps}
        emptyTitle="No mobile app profile yet"
        emptyDescription="When the PiB team adds your App Store or Google Play presence, it will appear here for review."
        showListingDetails
        showReleaseNotes
        renderActions={(app) => (
          <>
            {app.appStoreUrl && (
              <a href={app.appStoreUrl} target="_blank" rel="noreferrer" className="pib-btn-primary text-sm">
                Open App Store
              </a>
            )}
            {app.playStoreUrl && (
              <a href={app.playStoreUrl} target="_blank" rel="noreferrer" className="pib-btn-primary text-sm">
                Open Google Play
              </a>
            )}
            {app.supportUrl && (
              <a href={app.supportUrl} target="_blank" rel="noreferrer" className="pib-btn-ghost text-sm">
                Support
              </a>
            )}
          </>
        )}
        renderFooter={(app) => (
          <>
            {app.clientNotes && <p className="rounded-2xl bg-white/[0.04] p-3 text-sm">{app.clientNotes}</p>}
            {editingId === app.id ? (
              <div className="space-y-3 rounded-2xl border border-[var(--color-pib-line)] p-3">
                <label className="block text-sm">
                  <span className="eyebrow !text-[10px]">Notes for PiB</span>
                  <textarea
                    value={clientNotes}
                    onChange={(e) => setClientNotes(e.target.value)}
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3"
                  />
                </label>
                <label className="block text-sm">
                  <span className="eyebrow !text-[10px]">Listing feedback</span>
                  <textarea
                    value={clientFeedback}
                    onChange={(e) => setClientFeedback(e.target.value)}
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3"
                  />
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={saveFeedback} className="pib-btn-primary text-sm">
                    Save feedback
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className="pib-btn-ghost text-sm">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => startFeedback(app)} className="pib-btn-ghost text-sm">
                Leave feedback / request changes
              </button>
            )}
          </>
        )}
      />
    </MobileAppsWorkspaceShell>
  )
}
