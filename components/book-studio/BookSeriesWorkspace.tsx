'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppShell, EmptyState, PageHeader, StatusPill, Surface } from '@/components/ui/AppFoundation'
import { listBookFormats } from '@/lib/book-studio/format-registry'

type BookStudioSharedMetadata = {
  authorName?: string
  imprint?: string
  keywords?: string[]
  categories?: string[]
}

type BookStudioSeriesRecord = {
  id: string
  orgId?: string
  name?: string
  title?: string
  volumeOrder?: string[]
  sharedMetadata?: BookStudioSharedMetadata
  sharedStylePrompt?: string
}

type BookStudioProjectRecord = {
  id: string
  orgId?: string
  seriesId?: string
  title?: string
  status?: string
  stage?: string
  format?: string
  trim?: { presetId?: string }
  stylePrompt?: string
  seriesVolumeNumber?: number
  metadata?: { authorName?: string; imprint?: string }
  packageManifest?: { version?: number; files?: unknown[] }
  createdAt?: unknown
}

interface BookSeriesWorkspaceProps {
  orgId: string
  seriesId: string
}

const FORMAT_LABELS: Record<string, string> = Object.fromEntries(listBookFormats().map((format) => [format.id, format.label]))

function formatLabel(formatId?: string) {
  if (!formatId) return 'Unassigned format'
  return FORMAT_LABELS[formatId] ?? formatId
}

function statusTone(status?: string): 'rose' | 'success' | 'warn' | 'danger' {
  if (status === 'approved') return 'success'
  if (status === 'blocked') return 'danger'
  if (status === 'needs_review' || status === 'internal_review' || status === 'client_review') return 'warn'
  return 'rose'
}

function statusLabel(status?: string) {
  if (!status) return 'Not started'
  return status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function createdAtMillis(value: unknown): number {
  if (!value) return 0
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (typeof value === 'object' && value !== null && '_seconds' in (value as Record<string, unknown>)) {
    const seconds = (value as { _seconds?: number })._seconds
    return typeof seconds === 'number' ? seconds * 1000 : 0
  }
  return 0
}

/** Orders projects by volumeOrder, then appends any project missing from volumeOrder by seriesVolumeNumber then createdAt. */
function orderVolumes(projects: BookStudioProjectRecord[], volumeOrder: string[]): BookStudioProjectRecord[] {
  const byId = new Map(projects.map((project) => [project.id, project]))
  const ordered: BookStudioProjectRecord[] = []
  const seen = new Set<string>()

  for (const id of volumeOrder) {
    const project = byId.get(id)
    if (project && !seen.has(id)) {
      ordered.push(project)
      seen.add(id)
    }
  }

  const remaining = projects
    .filter((project) => !seen.has(project.id))
    .sort((a, b) => {
      const aVolume = a.seriesVolumeNumber ?? Number.MAX_SAFE_INTEGER
      const bVolume = b.seriesVolumeNumber ?? Number.MAX_SAFE_INTEGER
      if (aVolume !== bVolume) return aVolume - bVolume
      return createdAtMillis(a.createdAt) - createdAtMillis(b.createdAt)
    })

  return [...ordered, ...remaining]
}

async function unwrap(res: Response): Promise<{ ok: boolean; data: Record<string, unknown>; error?: string }> {
  const body = await res.json().catch(() => ({}))
  const data = (body?.data ?? body ?? {}) as Record<string, unknown>
  return { ok: res.ok, data, error: typeof body?.error === 'string' ? body.error : undefined }
}

export function BookSeriesWorkspace({ orgId, seriesId }: BookSeriesWorkspaceProps) {
  const [series, setSeries] = useState<BookStudioSeriesRecord | null>(null)
  const [projects, setProjects] = useState<BookStudioProjectRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reordering, setReordering] = useState(false)
  const [creatingVolume, setCreatingVolume] = useState(false)
  const [editingMetadata, setEditingMetadata] = useState(false)
  const [savingMetadata, setSavingMetadata] = useState(false)
  const [authorName, setAuthorName] = useState('')
  const [imprint, setImprint] = useState('')
  const [sharedStylePrompt, setSharedStylePrompt] = useState('')
  const loadRequestIdRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    const isCurrent = () => requestId === loadRequestIdRef.current
    setLoading(true)
    try {
      const [seriesRes, projectsRes] = await Promise.all([
        fetch(`/api/v1/book-studio/series?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/v1/book-studio/projects?orgId=${encodeURIComponent(orgId)}`),
      ])
      const [seriesBody, projectsBody] = await Promise.all([unwrap(seriesRes), unwrap(projectsRes)])
      if (!isCurrent()) return

      if (!seriesRes.ok || !projectsRes.ok) {
        setError(seriesBody.error ?? projectsBody.error ?? 'Could not load the Book Studio series workspace.')
      } else {
        setError('')
      }

      const seriesRecords = Array.isArray(seriesBody.data.records) ? (seriesBody.data.records as BookStudioSeriesRecord[]) : []
      const matchedSeries = seriesRecords.find((record) => record.id === seriesId) ?? null
      setSeries(matchedSeries)
      setAuthorName(matchedSeries?.sharedMetadata?.authorName ?? '')
      setImprint(matchedSeries?.sharedMetadata?.imprint ?? '')
      setSharedStylePrompt(matchedSeries?.sharedStylePrompt ?? '')

      const projectRecords = Array.isArray(projectsBody.data.records) ? (projectsBody.data.records as BookStudioProjectRecord[]) : []
      setProjects(projectRecords.filter((project) => project.seriesId === seriesId))
    } catch {
      if (!isCurrent()) return
      setSeries(null)
      setProjects([])
      setError('Could not load the Book Studio series workspace.')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [orgId, seriesId])

  useEffect(() => {
    void load()
    return () => {
      loadRequestIdRef.current += 1
    }
  }, [load])

  const volumeOrder = useMemo(() => (Array.isArray(series?.volumeOrder) ? series!.volumeOrder! : []), [series])
  const orderedVolumes = useMemo(() => orderVolumes(projects, volumeOrder), [projects, volumeOrder])
  const seriesTitle = series?.name ?? series?.title ?? 'Untitled series'

  async function patchSeries(patch: Record<string, unknown>) {
    const res = await fetch(`/api/v1/book-studio/series/${encodeURIComponent(seriesId)}?orgId=${encodeURIComponent(orgId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, ...patch }),
    })
    return unwrap(res)
  }

  async function reorder(projectId: string, direction: -1 | 1) {
    if (reordering) return
    const currentOrder = orderedVolumes.map((project) => project.id)
    const index = currentOrder.indexOf(projectId)
    const nextIndex = index + direction
    if (index === -1 || nextIndex < 0 || nextIndex >= currentOrder.length) return

    const nextOrder = [...currentOrder]
    ;[nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]]

    setReordering(true)
    setNotice('')
    try {
      const result = await patchSeries({ volumeOrder: nextOrder })
      if (!result.ok) {
        setNotice(result.error ?? 'Could not reorder volumes.')
        return
      }
      setNotice('Volume order updated.')
      await load()
    } catch {
      setNotice('Could not reorder volumes.')
    } finally {
      setReordering(false)
    }
  }

  async function saveSharedMetadata(event: React.FormEvent) {
    event.preventDefault()
    if (savingMetadata) return
    setSavingMetadata(true)
    setNotice('')
    try {
      const result = await patchSeries({
        sharedMetadata: {
          authorName: authorName.trim() || undefined,
          imprint: imprint.trim() || undefined,
          keywords: series?.sharedMetadata?.keywords,
          categories: series?.sharedMetadata?.categories,
        },
        sharedStylePrompt: sharedStylePrompt.trim() || undefined,
      })
      if (!result.ok) {
        setNotice(result.error ?? 'Could not save series metadata.')
        return
      }
      setNotice('Series metadata saved.')
      setEditingMetadata(false)
      await load()
    } catch {
      setNotice('Could not save series metadata.')
    } finally {
      setSavingMetadata(false)
    }
  }

  async function createNextVolume() {
    if (creatingVolume) return
    setCreatingVolume(true)
    setNotice('')
    try {
      const lastVolume = orderedVolumes[orderedVolumes.length - 1]
      const nextVolumeNumber = orderedVolumes.reduce((max, project) => Math.max(max, project.seriesVolumeNumber ?? 0), 0) + 1

      const createBody: Record<string, unknown> = {
        orgId,
        title: `${seriesTitle}  -  Volume ${nextVolumeNumber}`,
        seriesId,
        seriesVolumeNumber: nextVolumeNumber,
        metadata: {
          authorName: series?.sharedMetadata?.authorName,
          imprint: series?.sharedMetadata?.imprint,
        },
      }
      if (lastVolume?.format) createBody.format = lastVolume.format
      if (lastVolume?.trim) createBody.trim = lastVolume.trim
      if (lastVolume?.stylePrompt) createBody.stylePrompt = lastVolume.stylePrompt

      const createRes = await fetch('/api/v1/book-studio/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
      })
      const createResult = await unwrap(createRes)
      if (!createRes.ok) {
        setNotice(createResult.error ?? 'Could not create the next volume.')
        return
      }

      const newProjectId = createResult.data.id as string | undefined
      if (newProjectId) {
        const nextOrder = [...volumeOrder.filter((id) => id !== newProjectId), newProjectId]
        const patchResult = await patchSeries({ volumeOrder: nextOrder })
        if (!patchResult.ok) {
          setNotice(patchResult.error ?? 'Volume created, but could not update the series order.')
          await load()
          return
        }
      }

      setNotice('Next volume created.')
      await load()
    } catch {
      setNotice('Could not create the next volume.')
    } finally {
      setCreatingVolume(false)
    }
  }

  return (
    <AppShell
      contentClassName="bg-[var(--color-pib-bg)]"
      header={
        <PageHeader
          eyebrow="Book Studio · Series"
          title={seriesTitle}
          description="Manage shared series metadata, volume ordering, and create the next volume from the last one's format and style."
          meta={<span>Org ID: {orgId}</span>}
          actions={
            !loading && !series ? null : (
              <button type="button" onClick={() => void createNextVolume()} disabled={creatingVolume || loading || !series} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">
                {creatingVolume ? 'Creating…' : 'Create next volume'}
              </button>
            )
          }
        />
      }
    >
      <div className="space-y-6">
        {error ? (
          <Surface role="alert" className="border-red-200 bg-red-50 text-red-900">
            <strong>Series workspace load issue</strong>
            <p>{error}</p>
          </Surface>
        ) : null}

        {notice ? (
          <Surface role="status" className="border-[var(--color-pib-border)]">
            <p className="text-sm text-[var(--color-pib-text-muted)]">{notice}</p>
          </Surface>
        ) : null}

        {loading ? (
          <Surface><p className="text-sm text-[var(--color-pib-text-muted)]">Loading series workspace…</p></Surface>
        ) : !series ? (
          <EmptyState
            icon="auto_stories"
            title="Series not found"
            description="This Book Studio series could not be loaded for this organisation."
          />
        ) : (
          <>
            <Surface header={<h2 className="text-lg">Shared series metadata</h2>}>
              <div className="flex flex-wrap gap-2">
                <span className="pib-pill pib-pill-rose">
                  Author: {series.sharedMetadata?.authorName || 'Not set'}
                </span>
                <span className="pib-pill pib-pill-rose">
                  Imprint: {series.sharedMetadata?.imprint || 'Not set'}
                </span>
              </div>

              {!editingMetadata ? (
                <button type="button" className="btn-secondary mt-4" onClick={() => setEditingMetadata(true)}>
                  Edit shared metadata
                </button>
              ) : (
                <form onSubmit={saveSharedMetadata} className="mt-4 space-y-3">
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-[var(--color-pib-text)]">Author name</span>
                    <input
                      value={authorName}
                      onChange={(event) => setAuthorName(event.target.value)}
                      className="w-full rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-bg)] px-3 py-2 text-sm"
                     aria-label="Input"/>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-[var(--color-pib-text)]">Imprint</span>
                    <input
                      value={imprint}
                      onChange={(event) => setImprint(event.target.value)}
                      className="w-full rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-bg)] px-3 py-2 text-sm"
                     aria-label="Input"/>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-[var(--color-pib-text)]">Shared style prompt</span>
                    <textarea
                      value={sharedStylePrompt}
                      onChange={(event) => setSharedStylePrompt(event.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-bg)] px-3 py-2 text-sm"
                     aria-label="Input"/>
                  </label>
                  <div className="flex gap-2">
                    <button type="submit" disabled={savingMetadata} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">
                      {savingMetadata ? 'Saving…' : 'Save metadata'}
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setEditingMetadata(false)}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </Surface>

            <Surface header={<h2 className="text-lg">Volumes</h2>}>
              {orderedVolumes.length === 0 ? (
                <EmptyState
                  icon="menu_book"
                  title="No volumes yet"
                  description="Create the first volume for this series."
                  action={
                    <button type="button" onClick={() => void createNextVolume()} disabled={creatingVolume} className="btn-secondary">
                      {creatingVolume ? 'Creating…' : 'Create next volume'}
                    </button>
                  }
                />
              ) : (
                <ul className="space-y-3" aria-label="Series volumes">
                  {orderedVolumes.map((project, index) => {
                    const fileCount = Array.isArray(project.packageManifest?.files) ? project.packageManifest!.files!.length : 0
                    return (
                      <li key={project.id} className="flex flex-col gap-2 rounded-[6px] border border-[var(--color-pib-border)] p-4 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-center gap-3">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[color-mix(in_srgb,var(--st-danger)_10%,transparent)] text-xs text-[var(--st-danger)]">
                            {index + 1}
                          </span>
                          <div>
                            <Link href={`/admin/org/${encodeURIComponent(orgId)}/book-studio/${project.id}`} className="text-[var(--color-pib-text)] hover:underline">
                              {project.title ?? `Volume ${index + 1}`}
                            </Link>
                            <p className="text-xs text-[var(--color-pib-text-muted)]">{formatLabel(project.format)}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill tone={statusTone(project.status)}>{statusLabel(project.status)}</StatusPill>
                          {project.packageManifest?.version ? (
                            <span className="pib-pill pib-pill-rose">
                              Files v{project.packageManifest.version} · {fileCount}
                            </span>
                          ) : fileCount > 0 ? (
                            <span className="pib-pill pib-pill-rose">
                              Files · {fileCount}
                            </span>
                          ) : null}
                          <div className="flex gap-1">
                            <button
                              type="button"
                              aria-label={`Move ${project.title ?? 'volume'} up`}
                              onClick={() => void reorder(project.id, -1)}
                              disabled={reordering || index === 0}
                              className="btn-secondary px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              aria-label={`Move ${project.title ?? 'volume'} down`}
                              onClick={() => void reorder(project.id, 1)}
                              disabled={reordering || index === orderedVolumes.length - 1}
                              className="btn-secondary px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Surface>
          </>
        )}
      </div>
    </AppShell>
  )
}
