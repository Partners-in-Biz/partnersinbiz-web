'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'

interface PostTemplate {
  id: string
  name: string
  body: string
  category?: string
  variables: string[]
  usageCount?: number
  createdAt?: unknown
  updatedAt?: unknown
}

const VARIABLE_RE = /\{\{\s*([\w.-]+)\s*\}\}/g

function extractVariables(body: string): string[] {
  const found = new Set<string>()
  let match: RegExpExecArray | null
  VARIABLE_RE.lastIndex = 0
  while ((match = VARIABLE_RE.exec(body)) !== null) found.add(match[1])
  return Array.from(found)
}

export default function SocialTemplatesPage() {
  const [templates, setTemplates] = useState<PostTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  // editor state (create + edit share one form)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  const detectedVars = extractVariables(body)

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/social/templates')
      const json = await res.json()
      setTemplates(Array.isArray(json.data) ? json.data : [])
    } catch {
      setTemplates([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const resetForm = () => {
    setEditingId(null)
    setName('')
    setCategory('')
    setBody('')
  }

  const startEdit = (template: PostTemplate) => {
    setEditingId(template.id)
    setName(template.name)
    setCategory(template.category ?? '')
    setBody(template.body)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }

  const handleSave = async () => {
    if (!name.trim() || !body.trim()) {
      flash('Error: name and body are required')
      return
    }
    setSaving(true)
    try {
      const payload = { name: name.trim(), category: category.trim() || undefined, body }
      const res = editingId
        ? await fetch(`/api/v1/social/templates/${editingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/v1/social/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
      const json = await res.json()
      if (!res.ok || json.success === false) {
        flash(`Error: ${json.error ?? 'Failed to save template'}`)
        return
      }
      flash(editingId ? 'Template updated' : 'Template created')
      resetForm()
      await fetchTemplates()
    } catch (err) {
      flash(`Error: ${String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/social/templates/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok || json.success === false) {
        flash(`Error: ${json.error ?? 'Failed to delete'}`)
        return
      }
      if (editingId === id) resetForm()
      await fetchTemplates()
    } catch (err) {
      flash(`Error: ${String(err)}`)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-on-surface">Post Templates</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Reusable post-text templates with <code className="text-[var(--color-accent-v2)]">{'{{variable}}'}</code> placeholders. Insert them from the composer with “Use template”.
        </p>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-sm ${message.startsWith('Error') ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>
          {message}
        </div>
      )}

      {/* Editor */}
      <section className="p-4 rounded-lg bg-surface-container space-y-3">
        <h2 className="text-sm font-label uppercase tracking-widest text-on-surface-variant">
          {editingId ? 'Edit template' : 'New template'}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-on-surface-variant mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Product launch"
              className="w-full rounded-lg bg-surface px-3 py-2 text-sm text-on-surface outline-none border border-outline-variant focus:border-[var(--color-accent-v2)] transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-on-surface-variant mb-1">Category (optional)</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. promotions"
              className="w-full rounded-lg bg-surface px-3 py-2 text-sm text-on-surface outline-none border border-outline-variant focus:border-[var(--color-accent-v2)] transition-colors"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-on-surface-variant mb-1">Body</label>
          <textarea
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Big news, {{company}}! We just launched {{product}}. Learn more: {{link}}"
            className="w-full rounded-lg bg-surface px-3 py-2 text-sm text-on-surface outline-none border border-outline-variant focus:border-[var(--color-accent-v2)] transition-colors resize-none"
          />
          {detectedVars.length > 0 && (
            <p className="text-[11px] text-on-surface-variant mt-1">
              Detected placeholders: <span className="text-[var(--color-accent-v2)]">{detectedVars.map((v) => `{{${v}}}`).join(' ')}</span>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || !body.trim()}
            className="px-4 py-2 rounded-lg bg-[var(--color-accent-v2)] text-black font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : editingId ? 'Update template' : 'Create template'}
          </button>
          {editingId && (
            <button onClick={resetForm} className="px-4 py-2 rounded-lg bg-surface text-on-surface font-medium text-sm hover:bg-surface-container-high transition-colors">
              Cancel
            </button>
          )}
        </div>
      </section>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-surface-container animate-pulse" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="p-8 rounded-lg bg-surface-container text-center">
          <p className="text-on-surface-variant">No templates yet. Create your first one above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((template) => (
            <div key={template.id} className="p-4 rounded-lg bg-surface-container">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-on-surface">{template.name}</p>
                    {template.category && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant">{template.category}</span>
                    )}
                  </div>
                  <p className="text-sm text-on-surface-variant mt-1 whitespace-pre-wrap break-words">{template.body}</p>
                  {template.variables.length > 0 && (
                    <p className="text-[11px] text-[var(--color-accent-v2)] mt-1">{template.variables.map((v) => `{{${v}}}`).join(' ')}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    onClick={() => startEdit(template)}
                    className="text-xs px-2 py-1 rounded bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(template.id)}
                    className="text-xs px-2 py-1 rounded bg-surface-container-high text-red-400 hover:text-red-300 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
