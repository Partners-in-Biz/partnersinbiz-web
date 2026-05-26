'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

const STATUSES = ['discovery', 'design', 'development', 'review', 'live', 'maintenance'] as const
type ProjectStatus = (typeof STATUSES)[number]

interface Project {
  id: string
  clientId: string
  name: string
  description: string
  status: ProjectStatus
  startDate: unknown
  targetDate?: unknown
  createdAt: unknown
}

const STATUS_BADGE: Record<ProjectStatus, string> = {
  discovery: 'border-outline-variant text-on-surface-variant',
  design: 'border-blue-700 text-blue-400',
  development: 'border-yellow-700 text-yellow-400',
  review: 'border-orange-700 text-orange-400',
  live: 'border-green-700 text-green-400',
  maintenance: 'border-outline-variant text-on-surface-variant',
}

function formatDate(val: unknown): string {
  if (!val) return '—'
  const ts = val as Record<string, number>
  const secs = ts._seconds ?? ts.seconds
  if (secs) return new Date(secs * 1000).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
  if (typeof val === 'string') return new Date(val).toLocaleDateString()
  return '—'
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Form state
  const [name, setName] = useState('')
  const [clientId, setClientId] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<ProjectStatus>('discovery')
  const [startDate, setStartDate] = useState('')

  const fetchProjects = useCallback(async () => {
    const res = await fetch('/api/v1/projects?view=received')
    const body = await res.json()
    setProjects(body.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const res = await fetch('/api/v1/projects?view=received')
      const body = await res.json()
      if (cancelled) return
      setProjects(body.data ?? [])
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [])

  function openNew() {
    setName('')
    setClientId('')
    setDescription('')
    setStatus('discovery')
    setStartDate('')
    setError('')
    setShowNew(true)
  }

  async function createProject() {
    if (!name.trim() || !clientId.trim()) {
      setError(!name.trim() ? 'Name is required.' : 'Client organisation is required.')
      return
    }
    setSaving(true)
    setError('')
    const res = await fetch('/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, clientId: clientId.trim(), description, status, startDate: startDate || undefined }),
    })
    const body = await res.json()
    setSaving(false)
    if (!res.ok) {
      setError(body.error ?? 'Failed to create project.')
      return
    }
    setShowNew(false)
    fetchProjects()
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-headline text-2xl font-bold tracking-tighter">Projects</h1>
          <p className="text-on-surface-variant text-sm mt-0.5">{projects.length} total</p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 text-sm font-label text-black bg-on-surface hover:opacity-90 transition-opacity"
        >
          + New Project
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 bg-surface-container animate-pulse" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="border border-outline-variant p-12 text-center">
          <p className="text-on-surface-variant mb-3">No projects yet.</p>
          <button onClick={openNew} className="text-sm text-on-surface underline">
            Create one to get started →
          </button>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-outline-variant text-left">
              {['Name', 'Client', 'Status', 'Start Date', 'Target Date'].map((h) => (
                <th
                  key={h}
                  className="py-2 px-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant font-normal"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr
                key={p.id}
                className="border-b border-outline-variant hover:bg-surface-container transition-colors"
              >
                <td className="py-2.5 px-3">
                  <Link
                    href={`/admin/projects/${p.id}`}
                    className="text-on-surface hover:underline font-medium"
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="py-2.5 px-3 text-on-surface-variant">{p.clientId || '—'}</td>
                <td className="py-2.5 px-3">
                  <span
                    className={`border text-[10px] font-label uppercase tracking-widest px-2 py-0.5 ${STATUS_BADGE[p.status] ?? STATUS_BADGE.discovery}`}
                  >
                    {p.status}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-on-surface-variant">{formatDate(p.startDate)}</td>
                <td className="py-2.5 px-3 text-on-surface-variant">{formatDate(p.targetDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Slide-in panel */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/50" onClick={() => setShowNew(false)} />
          <div className="w-96 bg-surface-container border-l border-outline-variant flex flex-col overflow-y-auto">
            <div className="px-6 py-4 border-b border-outline-variant">
              <h2 className="font-headline text-base font-bold tracking-tight">New Project</h2>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4 flex-1">
              {error && (
                <p className="text-red-400 text-sm">{error}</p>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Website Redesign"
                  className="bg-transparent border border-outline-variant px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-on-surface"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                  Client
                </label>
                <input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Client ID"
                  className="bg-transparent border border-outline-variant px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-on-surface"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this project involve?"
                  rows={3}
                  className="bg-transparent border border-outline-variant px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-on-surface resize-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                  className="bg-surface-container border border-outline-variant px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-on-surface"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s} className="bg-black">
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-transparent border border-outline-variant px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-on-surface"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-outline-variant flex gap-3">
              <button
                onClick={createProject}
                disabled={saving}
                className="flex-1 py-2 text-sm font-label text-black bg-on-surface hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create Project'}
              </button>
              <button
                onClick={() => setShowNew(false)}
                className="px-4 py-2 text-sm font-label text-on-surface border border-outline-variant hover:bg-surface-container-high transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
