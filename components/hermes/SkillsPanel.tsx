'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { Icon } from '@/components/studio'

type Skill = {
  name: string
  description?: string | null
  fileCount: number
  sizeBytes: number
}

type Props = {
  orgId: string
  profileEnabled: boolean
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function SkillsPanel({ orgId, profileEnabled }: Props) {
  const apiBase = `/api/v1/admin/hermes/profiles/${orgId}/skills`
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    if (!profileEnabled) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(apiBase)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Failed to load skills (${res.status})`)
      }
      const body = await res.json()
      setSkills(body.data?.skills ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load skills')
    } finally {
      setLoading(false)
    }
  }, [apiBase, profileEnabled])

  useEffect(() => { load() }, [load])

  const upload = useCallback(async (file: File) => {
    if (!file.name.endsWith('.zip')) {
      setError('File must be a .zip')
      return
    }
    setError(null)
    setMessage(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(apiBase, { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`)
      setMessage(`Installed: ${body.data?.installed || 'skill'} (${body.data?.fileCount ?? '?'} files). Gateway restarting…`)
      // Wait a moment for systemd restart then reload
      setTimeout(() => load(), 4000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [apiBase, load])

  const remove = useCallback(async (name: string) => {
    if (!confirm(`Delete skill "${name}"? This will remove it from the VPS and restart the gateway.`)) return
    setError(null)
    try {
      const res = await fetch(`${apiBase}/${encodeURIComponent(name)}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Delete failed (${res.status})`)
      setMessage(`Deleted ${name}. Gateway restarting…`)
      setTimeout(() => load(), 4000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }, [apiBase, load])

  if (!profileEnabled) {
    return (
      <div className="pib-card text-sm text-[var(--color-pib-text-muted)]">
        Enable a Hermes profile link to manage skills.
      </div>
    )
  }

  return (
    <section className="pib-card space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium text-[var(--color-pib-text)]">Skills</h2>
          <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">
            {skills.length} installed on VPS. Drop a .zip to install a new skill.
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="pib-btn-secondary text-xs font-label px-3 py-1">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) upload(f)
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors ${
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-[var(--color-pib-line)] hover:border-primary/50'
        }`}
      >
        <Icon name="cloud_upload" className="text-3xl text-[var(--color-pib-text-muted)]" />
        <div className="text-sm text-[var(--color-pib-text)] text-center">
          {uploading ? 'Uploading…' : 'Drop a skill .zip here, or click to choose'}
        </div>
        <div className="text-xs text-[var(--color-pib-text-muted)]">Max 50 MB. Gateway auto-restarts after install.</div>
        <input data-impeccable-disable="content-invisible-at-rest" aria-label="Upload file"
          ref={inputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) upload(f)
            e.target.value = ''
          }}
        />
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{error}</div>}
      {message && <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-300">{message}</div>}

      <div className="grid gap-2 sm:grid-cols-2">
        {skills.length === 0 && !loading && (
          <div className="sm:col-span-2 text-sm text-[var(--color-pib-text-muted)] py-4 text-center">No skills installed.</div>
        )}
        {skills.map((s) => (
          <div key={s.name} className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-card)] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[var(--color-pib-text)] truncate">{s.name}</div>
                {s.description && <div className="text-xs text-[var(--color-pib-text-muted)] mt-0.5 line-clamp-2">{s.description}</div>}
                <div className="text-xs text-[var(--color-pib-text-muted)] mt-1">{s.fileCount} files · {formatBytes(s.sizeBytes)}</div>
              </div>
              <button
                type="button"
                onClick={() => remove(s.name)}
                className="text-xs text-[var(--st-danger)] hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10"
                title="Delete skill"
              >
                <Icon name="delete" className="text-[16px]" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
