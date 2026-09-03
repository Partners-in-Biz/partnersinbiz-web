'use client'

import { Icon } from '@/components/studio'
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
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <header>
        <p className="sc-tiny">Social · Templates</p>
        <h1 className="pib-page-title mt-2">Post Templates</h1>
        <p className="pib-page-sub">
          Reusable post-text templates with <code className="text-[var(--color-accent-v2)]">{'{{variable}}'}</code> placeholders. Insert them from the composer with “Use template”.
        </p>
      </header>

      {message && (
        <div className={`pib-card text-sm ${message.startsWith('Error') ? 'border-[var(--color-error)]/40 text-[var(--color-error)]' : 'text-[var(--color-pib-text)]'}`}>
          {message}
        </div>
      )}

      {/* Editor */}
      <section className="pib-card space-y-4">
        <h2 className="pib-label">
          {editingId ? 'Edit template' : 'New template'}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="pib-label block mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Product launch"
              className="pib-input w-full"
             aria-label="e.g. Product launch"/>
          </div>
          <div>
            <label className="pib-label block mb-1">Category (optional)</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. promotions"
              className="pib-input w-full"
             aria-label="e.g. promotions"/>
          </div>
        </div>
        <div>
          <label className="pib-label block mb-1">Body</label>
          <textarea
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Big news, {{company}}! We just launched {{product}}. Learn more: {{link}}"
            className="pib-textarea w-full resize-none"
           aria-label="Big news, {{company}}! We just launched {{product}}. Learn more: {{link}}"/>
          {detectedVars.length > 0 && (
            <p className="text-[11px] text-[var(--color-pib-text-muted)] mt-1">
              Detected placeholders: <span className="text-[var(--color-accent-v2)]">{detectedVars.map((v) => `{{${v}}}`).join(' ')}</span>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || !body.trim()}
            className="btn-pib-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : editingId ? 'Update template' : 'Create template'}
          </button>
          {editingId && (
            <button onClick={resetForm} className="btn-pib-ghost">
              Cancel
            </button>
          )}
        </div>
      </section>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="pib-skeleton h-20" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="pib-empty-state">
          <Icon name="description" />
          <h2 className="pib-empty-state-title">No templates yet. Create your first one above.</h2>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((template) => (
            <div key={template.id} className="pib-card">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="shrink-0">
                    <Icon name="description" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-[var(--color-pib-text)]">{template.name}</p>
                      {template.category && (
                        <span className="pib-pill pib-pill-rose">{template.category}</span>
                      )}
                    </div>
                    <p className="text-sm text-[var(--color-pib-text-muted)] mt-1 whitespace-pre-wrap break-words">{template.body}</p>
                    {template.variables.length > 0 && (
                      <p className="text-[11px] text-[var(--color-accent-v2)] mt-1">{template.variables.map((v) => `{{${v}}}`).join(' ')}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    onClick={() => startEdit(template)}
                    className="btn-pib-ghost text-xs"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(template.id)}
                    className="btn-pib-ghost text-xs text-[var(--color-error)]"
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
