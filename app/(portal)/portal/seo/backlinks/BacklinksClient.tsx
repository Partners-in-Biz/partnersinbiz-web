'use client'

import { useMemo, useState } from 'react'
import { SeoToolHeader, type SprintOption } from '@/components/seo/SeoToolHeader'
import { downloadText } from '@/components/seo/seoToolClient'
import { toCsv } from '@/lib/seo/csv'
import type { BacklinkProfile, BacklinkRow } from '@/lib/seo/backlink-profile'

type RelFilter = 'all' | 'dofollow' | 'nofollow'
type StatusFilter = 'all' | 'live' | 'submitted'

export function BacklinksClient({
  profile,
  sprints,
  activeSprintId,
}: {
  profile: BacklinkProfile | null
  sprints: SprintOption[]
  activeSprintId?: string
}) {
  const [relFilter, setRelFilter] = useState<RelFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  const links = useMemo<BacklinkRow[]>(() => {
    if (!profile) return []
    const q = search.trim().toLowerCase()
    return profile.links.filter((l) => {
      if (relFilter !== 'all' && l.rel !== relFilter) return false
      if (statusFilter !== 'all' && l.status !== statusFilter) return false
      if (q && !l.domain.toLowerCase().includes(q) && !l.anchorText.toLowerCase().includes(q)) return false
      return true
    })
  }, [profile, relFilter, statusFilter, search])

  function toggleDomain(domain: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(domain)) next.delete(domain)
      else next.add(domain)
      return next
    })
  }

  function handleExportCsv() {
    const rows = links.map((l) => ({
      domain: l.domain,
      sourceUrl: l.sourceUrl,
      anchorText: l.anchorText,
      rel: l.rel,
      domainAuthority: l.domainAuthority ?? '',
      firstSeen: l.firstSeen.slice(0, 10),
      status: l.status,
      discoveredVia: l.discoveredVia,
    }))
    const csv = toCsv(rows, [
      { key: 'domain', label: 'Referring Domain' },
      { key: 'sourceUrl', label: 'Source URL' },
      { key: 'anchorText', label: 'Anchor Text' },
      { key: 'rel', label: 'Rel' },
      { key: 'domainAuthority', label: 'Domain Authority' },
      { key: 'firstSeen', label: 'First Seen' },
      { key: 'status', label: 'Status' },
      { key: 'discoveredVia', label: 'Discovered Via' },
    ])
    downloadText('backlinks.csv', csv)
  }

  async function handleDisavow() {
    if (!activeSprintId || selected.size === 0) return
    setBusy(true)
    try {
      const res = await fetch('/api/v1/seo/backlinks/disavow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sprintId: activeSprintId, domains: Array.from(selected) }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error ?? `Request failed (${res.status})`)
      }
      const text = await res.text()
      downloadText('disavow.txt', text, 'text/plain;charset=utf-8')
      showToast(`Disavow file generated for ${selected.size} domain(s)`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to generate disavow file')
    } finally {
      setBusy(false)
    }
  }

  const t = profile?.totals

  return (
    <div className="space-y-6">
      <SeoToolHeader
        eyebrow="Off-page SEO"
        title="Backlink checker"
        description="Monitor referring domains, anchor text, DoFollow/NoFollow split, and new vs lost links. Export to CSV or build a Google disavow file."
        sprints={sprints}
        activeSprintId={activeSprintId}
        action={
          <button onClick={handleExportCsv} disabled={links.length === 0} className="pib-btn-secondary text-sm disabled:opacity-40">
            <span className="material-symbols-outlined text-[18px]">download</span>
            Export CSV
          </button>
        }
      />

      {!profile ? (
        <div className="pib-card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
          No active SEO sprint. Create a sprint to start tracking backlinks.
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            <StatCard label="Backlinks" value={t!.backlinks.toLocaleString('en-ZA')} icon="link" />
            <StatCard label="Referring domains" value={t!.referringDomains.toLocaleString('en-ZA')} icon="hub" />
            <StatCard label="New this month" value={`+${t!.newThisMonth}`} icon="trending_up" highlight={t!.newThisMonth > 0 ? 'good' : undefined} />
            <StatCard label="Lost this month" value={`-${t!.lostThisMonth}`} icon="trending_down" highlight={t!.lostThisMonth > 0 ? 'bad' : undefined} />
            <StatCard label="DoFollow" value={t!.dofollow.toLocaleString('en-ZA')} icon="check_circle" />
            <StatCard label="NoFollow" value={t!.nofollow.toLocaleString('en-ZA')} icon="block" />
          </section>

          {/* Referring domains */}
          <section className="pib-card-section overflow-hidden">
            <div className="pib-card-section-header flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold">Referring domains</h3>
                <p className="text-xs text-[var(--color-pib-text-muted)]">Select domains to include in a disavow file. Sorted by domain authority.</p>
              </div>
              <button
                onClick={handleDisavow}
                disabled={busy || selected.size === 0}
                className="pib-btn-secondary text-sm disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[18px]">gpp_bad</span>
                Disavow {selected.size > 0 ? `(${selected.size})` : ''}
              </button>
            </div>
            {profile.referringDomains.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--color-pib-text-muted)]">No referring domains discovered yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] text-left">
                      <th className="px-5 py-3 eyebrow !text-[10px] w-10"></th>
                      <th className="px-5 py-3 eyebrow !text-[10px]">Domain</th>
                      <th className="px-5 py-3 eyebrow !text-[10px] text-right">DA</th>
                      <th className="px-5 py-3 eyebrow !text-[10px] text-right">Links</th>
                      <th className="px-5 py-3 eyebrow !text-[10px] text-right">DoFollow</th>
                      <th className="px-5 py-3 eyebrow !text-[10px] text-right">NoFollow</th>
                      <th className="px-5 py-3 eyebrow !text-[10px]">First seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-pib-line)]">
                    {profile.referringDomains.map((d) => (
                      <tr key={d.domain} className="hover:bg-[var(--color-pib-surface-2)]">
                        <td className="px-5 py-3">
                          <input type="checkbox" checked={selected.has(d.domain)} onChange={() => toggleDomain(d.domain)} className="accent-[var(--color-pib-accent)]" />
                        </td>
                        <td className="px-5 py-3 font-medium flex items-center gap-2">
                          {d.domain}
                          {d.isNew && <span className="pib-pill pib-pill-success text-[10px]">NEW</span>}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">{d.domainAuthority != null ? d.domainAuthority.toFixed(0) : '—'}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{d.links}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{d.dofollow}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{d.nofollow}</td>
                        <td className="px-5 py-3 tabular-nums text-[var(--color-pib-text-muted)]">{d.firstSeen.slice(0, 10) || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Top anchors */}
          {profile.topAnchors.length > 0 && (
            <section className="pib-card-section">
              <div className="pib-card-section-header">
                <h3 className="text-sm font-semibold">Top anchor text</h3>
                <p className="text-xs text-[var(--color-pib-text-muted)]">Most common anchor text across all inbound links.</p>
              </div>
              <div className="flex flex-wrap gap-2 p-4">
                {profile.topAnchors.map((a) => (
                  <span key={a.anchor} className="pib-pill text-xs">
                    {a.anchor} <span className="text-[var(--color-pib-text-muted)]">· {a.count}</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* All links table with filters */}
          <section className="pib-card-section overflow-hidden">
            <div className="pib-card-section-header flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-sm font-semibold">All backlinks</h3>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search domain or anchor…"
                  className="pib-input !w-auto text-xs"
                />
                <select value={relFilter} onChange={(e) => setRelFilter(e.target.value as RelFilter)} className="pib-select !w-auto text-xs">
                  <option value="all">All rel</option>
                  <option value="dofollow">DoFollow</option>
                  <option value="nofollow">NoFollow</option>
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="pib-select !w-auto text-xs">
                  <option value="all">All status</option>
                  <option value="live">Live</option>
                  <option value="submitted">Submitted</option>
                </select>
              </div>
            </div>
            {links.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--color-pib-text-muted)]">No backlinks match these filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] text-left">
                      <th className="px-5 py-3 eyebrow !text-[10px]">Source</th>
                      <th className="px-5 py-3 eyebrow !text-[10px]">Anchor</th>
                      <th className="px-5 py-3 eyebrow !text-[10px]">Rel</th>
                      <th className="px-5 py-3 eyebrow !text-[10px] text-right">DA</th>
                      <th className="px-5 py-3 eyebrow !text-[10px]">First seen</th>
                      <th className="px-5 py-3 eyebrow !text-[10px]">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-pib-line)]">
                    {links.map((l) => (
                      <tr key={l.id} className="hover:bg-[var(--color-pib-surface-2)]">
                        <td className="px-5 py-3 max-w-xs truncate">
                          {l.sourceUrl ? (
                            <a href={l.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--color-pib-accent)]">{l.domain}</a>
                          ) : (
                            l.domain
                          )}
                        </td>
                        <td className="px-5 py-3 max-w-xs truncate text-[var(--color-pib-text-muted)]">{l.anchorText || '—'}</td>
                        <td className="px-5 py-3">
                          <span className={`pib-pill text-[10px] ${l.rel === 'dofollow' ? 'pib-pill-success' : ''}`}>{l.rel}</span>
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">{l.domainAuthority != null ? l.domainAuthority.toFixed(0) : '—'}</td>
                        <td className="px-5 py-3 tabular-nums text-[var(--color-pib-text-muted)]">{l.firstSeen.slice(0, 10) || '—'}</td>
                        <td className="px-5 py-3">
                          <span className="pib-pill text-[10px]">{l.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-4 py-3 text-sm shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, icon, highlight }: { label: string; value: string; icon: string; highlight?: 'good' | 'bad' }) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p className={`mt-3 font-display text-2xl leading-none tracking-tight md:text-3xl ${highlight === 'good' ? 'text-emerald-300' : highlight === 'bad' ? 'text-red-300' : ''}`}>{value}</p>
    </div>
  )
}
