'use client'

import { useRef, useState } from 'react'
import { SeoToolHeader, type SprintOption } from '@/components/seo/SeoToolHeader'

type Sections = { traffic: boolean; rankings: boolean; backlinks: boolean }

export type ReportRow = {
  id: string
  clientName: string
  from: string
  to: string
  createdAt: string
  shareToken: string | null
  shareExpiresAt: string | null
  sections: Sections
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function ReportsClient({
  sprints,
  activeSprintId,
  defaultClientName,
  history,
}: {
  sprints: SprintOption[]
  activeSprintId?: string
  defaultClientName: string
  history: ReportRow[]
}) {
  const [clientName, setClientName] = useState(defaultClientName)
  const [from, setFrom] = useState(isoDaysAgo(30))
  const [to, setTo] = useState(isoDaysAgo(0))
  const [brandColor, setBrandColor] = useState('#4F46E5')
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)
  const [sections, setSections] = useState<Sections>({ traffic: true, rankings: true, backlinks: true })
  const [rows, setRows] = useState<ReportRow[]>(history)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  function config() {
    return { clientName, from, to, brandColor, logoDataUrl: logoDataUrl ?? undefined, sections }
  }

  function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 500_000) {
      showToast('Logo too large — use an image under 500KB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setLogoDataUrl(typeof reader.result === 'string' ? reader.result : null)
    reader.readAsDataURL(file)
  }

  async function streamPdf(url: string, payload?: unknown, filename = 'seo-report.pdf') {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      throw new Error(json?.error ?? `Request failed (${res.status})`)
    }
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(objUrl)
  }

  async function preview() {
    if (!activeSprintId) return
    setBusy(true)
    try {
      await streamPdf('/api/v1/seo/reports/generate', { sprintId: activeSprintId, config: config() })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to generate report')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!activeSprintId) return
    setBusy(true)
    try {
      const res = await fetch('/api/v1/seo/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sprintId: activeSprintId, config: config() }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(json?.error ?? `Request failed (${res.status})`)
      setRows((prev) => [
        { id: json.data.id, clientName, from, to, createdAt: new Date().toISOString(), shareToken: null, shareExpiresAt: null, sections },
        ...prev,
      ])
      showToast('Report saved to history')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save report')
    } finally {
      setBusy(false)
    }
  }

  async function toggleShare(row: ReportRow) {
    const enabling = !row.shareToken
    try {
      const res = await fetch(`/api/v1/seo/reports/${row.id}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: enabling, expiresInDays: 30 }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(json?.error ?? `Request failed (${res.status})`)
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, shareToken: json.data.token, shareExpiresAt: json.data.expiresAt } : r,
        ),
      )
      if (enabling && json.data.url) {
        try {
          await navigator.clipboard.writeText(json.data.url)
          showToast('Public link copied to clipboard')
        } catch {
          showToast('Share link enabled')
        }
      } else {
        showToast('Sharing disabled')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to toggle sharing')
    }
  }

  async function remove(row: ReportRow) {
    if (!confirm('Delete this saved report?')) return
    try {
      const res = await fetch(`/api/v1/seo/reports/${row.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      setRows((prev) => prev.filter((r) => r.id !== row.id))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete report')
    }
  }

  return (
    <div className="space-y-6">
      <SeoToolHeader
        eyebrow="Reporting"
        title="Branded SEO reports"
        description="Build a white-labelled SEO report — pick a date range, add your client's logo and brand colour, choose sections, and export a branded PDF or share a public link."
        sprints={sprints}
        activeSprintId={activeSprintId}
      />

      {!activeSprintId ? (
        <div className="pib-card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
          No active SEO sprint. Create a sprint to build reports.
        </div>
      ) : (
        <section className="pib-card-section">
          <div className="pib-card-section-header">
            <h3 className="text-sm font-semibold">Report builder</h3>
            <p className="text-xs text-[var(--color-pib-text-muted)]">Configure the report, then preview the PDF or save it to history.</p>
          </div>
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="pib-label" htmlFor="cn">Client name</label>
              <input id="cn" value={clientName} onChange={(e) => setClientName(e.target.value)} className="pib-input" placeholder="Acme Pty Ltd" />
            </div>
            <div>
              <label className="pib-label" htmlFor="from">From</label>
              <input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="pib-input" />
            </div>
            <div>
              <label className="pib-label" htmlFor="to">To</label>
              <input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="pib-input" />
            </div>
            <div>
              <label className="pib-label" htmlFor="bc">Brand colour</label>
              <div className="flex items-center gap-2">
                <input id="bc" type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-9 w-12 rounded-lg border border-[var(--color-pib-line)] bg-transparent" />
                <input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="pib-input !w-auto flex-1 text-xs" />
              </div>
            </div>
          </div>

          <div className="grid gap-4 px-4 pb-2 sm:grid-cols-2">
            <div>
              <label className="pib-label">Logo</label>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => fileRef.current?.click()} className="pib-btn-secondary text-xs">
                  <span className="material-symbols-outlined text-[16px]">upload</span>
                  {logoDataUrl ? 'Replace logo' : 'Upload logo'}
                </button>
                {logoDataUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoDataUrl} alt="Logo preview" className="h-9 w-9 rounded-md border border-[var(--color-pib-line)] object-contain bg-white" />
                )}
                {logoDataUrl && (
                  <button type="button" onClick={() => setLogoDataUrl(null)} className="text-xs text-[var(--color-pib-text-muted)] hover:text-red-300">Remove</button>
                )}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogo} />
              </div>
            </div>
            <div>
              <label className="pib-label">Sections</label>
              <div className="flex flex-wrap gap-4 pt-1.5">
                {(['traffic', 'rankings', 'backlinks'] as const).map((sec) => (
                  <label key={sec} className="inline-flex items-center gap-2 text-xs capitalize">
                    <input
                      type="checkbox"
                      checked={sections[sec]}
                      onChange={(e) => setSections((s) => ({ ...s, [sec]: e.target.checked }))}
                      className="accent-[var(--color-pib-accent)]"
                    />
                    {sec}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 p-4">
            <button onClick={preview} disabled={busy} className="pib-btn-primary text-sm disabled:opacity-40">
              {busy ? (
                <><span className="material-symbols-outlined animate-spin text-[18px]">autorenew</span>Building…</>
              ) : (
                <><span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>Preview PDF</>
              )}
            </button>
            <button onClick={save} disabled={busy} className="pib-btn-secondary text-sm disabled:opacity-40">
              <span className="material-symbols-outlined text-[18px]">save</span>
              Save to history
            </button>
          </div>
        </section>
      )}

      {/* History */}
      <section className="pib-card-section overflow-hidden">
        <div className="pib-card-section-header">
          <h3 className="text-sm font-semibold">Report history</h3>
          <p className="text-xs text-[var(--color-pib-text-muted)]">Saved reports. Toggle a public share link (expires in 30 days) or re-download.</p>
        </div>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-pib-text-muted)]">No saved reports yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] text-left">
                  <th className="px-5 py-3 eyebrow !text-[10px]">Client</th>
                  <th className="px-5 py-3 eyebrow !text-[10px]">Range</th>
                  <th className="px-5 py-3 eyebrow !text-[10px]">Created</th>
                  <th className="px-5 py-3 eyebrow !text-[10px]">Share</th>
                  <th className="px-5 py-3 eyebrow !text-[10px] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-pib-line)]">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-[var(--color-pib-surface-2)]">
                    <td className="px-5 py-3 font-medium">{r.clientName || '—'}</td>
                    <td className="px-5 py-3 tabular-nums text-xs text-[var(--color-pib-text-muted)]">{r.from} → {r.to}</td>
                    <td className="px-5 py-3 tabular-nums text-xs text-[var(--color-pib-text-muted)]">{r.createdAt.slice(0, 10)}</td>
                    <td className="px-5 py-3">
                      {r.shareToken ? (
                        <span className="pib-pill pib-pill-success text-[10px]">
                          Live{r.shareExpiresAt ? ` · exp ${r.shareExpiresAt.slice(0, 10)}` : ''}
                        </span>
                      ) : (
                        <span className="pib-pill text-[10px]">Private</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => toggleShare(r)} className="pib-btn-secondary text-xs !py-1.5">
                          <span className="material-symbols-outlined text-[14px]">{r.shareToken ? 'link_off' : 'link'}</span>
                          {r.shareToken ? 'Unshare' : 'Share'}
                        </button>
                        <button onClick={() => remove(r)} className="inline-flex items-center gap-1 rounded-full border border-red-500/35 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/10">
                          <span className="material-symbols-outlined text-[14px]">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-4 py-3 text-sm shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  )
}
