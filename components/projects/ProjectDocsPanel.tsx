'use client'

export interface ProjectDoc {
  id: string
  title: string
  content?: string
  type: 'brief' | 'requirements' | 'notes' | 'reference'
  createdBy: string
  updatedBy?: string
  createdAt?: unknown
  updatedAt?: unknown
}

const TYPE_COLORS: Record<string, string> = {
  brief: 'border-[var(--color-accent-v2)] bg-[var(--color-surface-container)] text-on-surface',
  requirements: 'border-[var(--color-accent-v2)] bg-[var(--color-surface-container)] text-on-surface',
  notes: 'border-[var(--color-card-border)] bg-[var(--color-card)] text-on-surface-variant',
  reference: 'border-[var(--color-card-border)] bg-[var(--color-card)] text-on-surface-variant',
}

export function projectDocContent(content: unknown): string {
  return typeof content === 'string' ? content : ''
}

function docPreview(content: unknown): string {
  const preview = projectDocContent(content).replace(/\s+/g, ' ').trim()
  if (!preview) return 'No preview content yet.'
  return preview.length > 180 ? `${preview.slice(0, 180).trim()}...` : preview
}

function timestampToMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function formatDate(value: unknown): string {
  const millis = timestampToMillis(value)
  if (!millis) return 'No date'
  return new Date(millis).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

interface ProjectDocsPanelProps {
  briefValue: string
  docs: ProjectDoc[]
  editingBrief: boolean
  editingDoc: ProjectDoc | null
  selectedDoc: ProjectDoc | null
  savingBrief: boolean
  onBriefChange: (value: string) => void
  onEditBrief: () => void
  onCancelBrief: () => void
  onSaveBrief: () => void
  onEditDoc: (doc: ProjectDoc | null) => void
  onEditingDocChange: (doc: ProjectDoc) => void
  onSelectDoc: (doc: ProjectDoc) => void
  onSaveDoc: () => void
  onDeleteDoc: (docId: string) => void
}

const blankDoc = (): ProjectDoc => ({ id: '', title: '', content: '', type: 'notes', createdBy: '' })

export function ProjectDocsPanel({
  briefValue,
  docs,
  editingBrief,
  editingDoc,
  selectedDoc,
  savingBrief,
  onBriefChange,
  onEditBrief,
  onCancelBrief,
  onSaveBrief,
  onEditDoc,
  onEditingDocChange,
  onSelectDoc,
  onSaveDoc,
  onDeleteDoc,
}: ProjectDocsPanelProps) {
  return (
    <div className="flex-1 overflow-auto space-y-6 pb-6">
      <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Project docs</p>
            <h2 className="mt-1 text-2xl font-headline font-bold text-on-surface">Brief and knowledge base</h2>
            <p className="mt-2 max-w-2xl text-sm text-on-surface-variant">Keep project context close to the board. Open any document to preview it before editing.</p>
          </div>
          <button
            type="button"
            onClick={() => onEditDoc(blankDoc())}
            className="pib-btn-primary text-sm font-label"
          >
            <span className="material-symbols-outlined text-[17px]">note_add</span>
            New Document
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Source of truth</p>
            <h2 className="mt-1 text-lg font-headline font-bold text-on-surface">Project Brief</h2>
          </div>
          {!editingBrief && (
            <button onClick={onEditBrief} className="pib-btn-secondary text-sm font-label">Edit brief</button>
          )}
        </div>
        {editingBrief ? (
          <div className="space-y-3">
            <textarea
              value={briefValue}
              onChange={e => onBriefChange(e.target.value)}
              placeholder="Add a project brief... What's this project about? Goals, constraints, key stakeholders."
              className="w-full rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-[var(--color-accent-v2)]"
              rows={4}
            />
            <div className="flex gap-2">
              <button onClick={onSaveBrief} disabled={savingBrief} className="pib-btn-primary text-sm font-label">
                {savingBrief ? 'Saving...' : 'Save'}
              </button>
              <button onClick={onCancelBrief} className="pib-btn-secondary text-sm font-label">Cancel</button>
            </div>
          </div>
        ) : (
          <p className={`min-h-[96px] whitespace-pre-wrap rounded-xl border border-[var(--color-card-border)] px-4 py-3 text-sm leading-6 ${briefValue ? 'bg-[var(--color-background)] text-on-surface' : 'bg-[var(--color-background)] text-on-surface-variant italic'}`}>
            {briefValue || 'No brief yet'}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Library</p>
            <h2 className="mt-1 text-lg font-headline font-bold text-on-surface">Documents</h2>
          </div>
          <span className="rounded-full border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-1 text-xs text-on-surface-variant">{docs.length} docs</span>
        </div>

        {editingDoc ? (
          <div className="mb-4 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] p-4 space-y-3">
            <input
              type="text"
              placeholder="Document title..."
              value={editingDoc.title}
              onChange={e => onEditingDocChange({ ...editingDoc, title: e.target.value })}
              className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
            />
            <select
              value={editingDoc.type}
              onChange={e => onEditingDocChange({ ...editingDoc, type: e.target.value as ProjectDoc['type'] })}
              className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
            >
              <option value="brief">Brief</option>
              <option value="requirements">Requirements</option>
              <option value="notes">Notes</option>
              <option value="reference">Reference</option>
            </select>
            <textarea
              placeholder="Content (markdown)..."
              value={projectDocContent(editingDoc.content)}
              onChange={e => onEditingDocChange({ ...editingDoc, content: e.target.value })}
              className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-[var(--color-accent-v2)]"
              rows={10}
            />
            <div className="flex gap-2">
              <button onClick={onSaveDoc} className="pib-btn-primary text-sm font-label">Save</button>
              <button onClick={() => onEditDoc(null)} className="pib-btn-secondary text-sm font-label">Cancel</button>
            </div>
          </div>
        ) : null}

        {!editingDoc && (
          <>
            {docs.length ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
                <div className="space-y-3">
                  {docs.map(doc => (
                    <div key={doc.id} className={`rounded-xl border bg-[var(--color-background)] p-1 transition-colors ${selectedDoc?.id === doc.id ? 'border-[var(--color-accent-v2)]' : 'border-[var(--color-card-border)] hover:border-[var(--color-outline)]'}`}>
                      <button
                        type="button"
                        onClick={() => onSelectDoc(doc)}
                        className="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left"
                        aria-label={`Preview ${doc.title}`}
                      >
                        <span className="material-symbols-outlined mt-0.5 text-[22px] text-on-surface-variant">description</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-on-surface">{doc.title}</span>
                          <span className="mt-2 block text-xs leading-5 text-on-surface-variant">{docPreview(doc.content)}</span>
                          <span className={`mt-3 inline-block rounded-full border px-2.5 py-1 text-[10px] font-label uppercase tracking-widest ${TYPE_COLORS[doc.type] || TYPE_COLORS.notes}`}>
                            {doc.type}
                          </span>
                        </span>
                      </button>
                      <div className="flex items-center justify-end gap-2 border-t border-[var(--color-card-border)] px-3 py-2">
                        <button onClick={() => onEditDoc(doc)} className="pib-btn-secondary text-xs font-label">Edit</button>
                        <button onClick={() => onDeleteDoc(doc.id)} className="text-xs font-label text-red-400 hover:text-red-300">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="min-h-[320px] rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] p-5">
                  {selectedDoc ? (
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <span className={`inline-block rounded-full border px-2.5 py-1 text-[10px] font-label uppercase tracking-widest ${TYPE_COLORS[selectedDoc.type] || TYPE_COLORS.notes}`}>{selectedDoc.type}</span>
                          <h3 className="mt-3 text-xl font-headline font-bold text-on-surface">{selectedDoc.title}</h3>
                          <p className="mt-1 text-xs text-on-surface-variant">Updated {formatDate(selectedDoc.updatedAt ?? selectedDoc.createdAt)}</p>
                        </div>
                        <button onClick={() => onEditDoc(selectedDoc)} className="pib-btn-secondary text-xs font-label">Edit</button>
                      </div>
                      <div className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-4 text-sm leading-6 text-on-surface">
                        {projectDocContent(selectedDoc.content) || 'This document is empty.'}
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
                      <span className="material-symbols-outlined text-[40px] text-on-surface-variant">preview</span>
                      <h3 className="mt-3 text-base font-headline font-bold text-on-surface">Select a document</h3>
                      <p className="mt-2 max-w-xs text-sm text-on-surface-variant">Click a document on the left to open its preview here.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--color-card-border)] bg-[var(--color-background)] p-8 text-center">
                <span className="material-symbols-outlined text-[40px] text-on-surface-variant">draft</span>
                <h3 className="mt-3 text-base font-headline font-bold text-on-surface">No documents yet</h3>
                <p className="mt-2 text-sm text-on-surface-variant">Create the first project note, brief, requirement, or reference doc.</p>
                <button onClick={() => onEditDoc(blankDoc())} className="pib-btn-secondary mt-4 text-sm font-label">
                  New Document
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
