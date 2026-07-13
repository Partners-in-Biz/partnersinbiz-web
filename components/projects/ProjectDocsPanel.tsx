'use client'

import { useState } from 'react'

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
  brief: 'border-[var(--color-accent-v2)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)]',
  requirements: 'border-[var(--color-accent-v2)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)]',
  notes: 'border-[var(--color-pib-line)] bg-[var(--color-card)] text-[var(--color-pib-text-muted)]',
  reference: 'border-[var(--color-pib-line)] bg-[var(--color-card)] text-[var(--color-pib-text-muted)]',
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
  const [deleteCandidate, setDeleteCandidate] = useState<ProjectDoc | null>(null)

  function confirmDeleteDoc() {
    if (!deleteCandidate) return
    onDeleteDoc(deleteCandidate.id)
    setDeleteCandidate(null)
  }

  return (
    <div className="flex-1 overflow-auto space-y-6 pb-6">
      <div className="pib-card rounded-[var(--radius-card)] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="pib-label">Project docs</p>
            <h2 className="mt-1 text-2xl font-headline font-bold text-[var(--color-pib-text)]">Brief and knowledge base</h2>
            <p className="mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">Keep project context close to the board. Open any document to preview it before editing.</p>
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

      <div className="pib-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="pib-label">Source of truth</p>
            <h2 className="mt-1 text-lg font-headline font-bold text-[var(--color-pib-text)]">Project Brief</h2>
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
              className="pib-textarea w-full"
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
          <p className={`min-h-[96px] whitespace-pre-wrap rounded-[var(--radius-card)] border border-[var(--color-pib-line)] px-4 py-3 text-sm leading-6 ${briefValue ? 'bg-[var(--color-background)] text-[var(--color-pib-text)]' : 'bg-[var(--color-background)] text-[var(--color-pib-text-muted)] italic'}`}>
            {briefValue || 'No brief yet'}
          </p>
        )}
      </div>

      <div className="pib-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="pib-label">Library</p>
            <h2 className="mt-1 text-lg font-headline font-bold text-[var(--color-pib-text)]">Documents</h2>
          </div>
          <span className="rounded-full border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-1 text-xs text-[var(--color-pib-text-muted)]">{docs.length} docs</span>
        </div>

        {editingDoc ? (
          <div className="mb-4 pib-surface p-4 space-y-3">
            <input
              type="text"
              placeholder="Document title..."
              value={editingDoc.title}
              onChange={e => onEditingDocChange({ ...editingDoc, title: e.target.value })}
              className="pib-input w-full"
            />
            <select
              value={editingDoc.type}
              onChange={e => onEditingDocChange({ ...editingDoc, type: e.target.value as ProjectDoc['type'] })}
              className="pib-select w-full"
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
              className="pib-textarea w-full"
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
                    <div key={doc.id} className={`rounded-[var(--radius-card)] border bg-[var(--color-background)] p-1 transition-colors ${selectedDoc?.id === doc.id ? 'border-[var(--color-accent-v2)]' : 'border-[var(--color-pib-line)] hover:border-[var(--color-pib-line-strong)]'}`}>
                      <button
                        type="button"
                        onClick={() => onSelectDoc(doc)}
                        className="flex w-full items-start gap-3 rounded-[var(--radius-btn)] px-3 py-3 text-left"
                        aria-label={`Preview ${doc.title}`}
                      >
                        <span className="material-symbols-outlined mt-0.5 text-[22px] text-[var(--color-pib-text-muted)]">description</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-[var(--color-pib-text)]">{doc.title}</span>
                          <span className="mt-2 block text-xs leading-5 text-[var(--color-pib-text-muted)]">{docPreview(doc.content)}</span>
                          <span className={`mt-3 inline-block rounded-full border px-2.5 py-1 text-[10px] font-label uppercase tracking-widest ${TYPE_COLORS[doc.type] || TYPE_COLORS.notes}`}>
                            {doc.type}
                          </span>
                        </span>
                      </button>
                      <div className="flex items-center justify-end gap-2 border-t border-[var(--color-pib-line)] px-3 py-2">
                        <button onClick={() => onEditDoc(doc)} className="pib-btn-secondary text-xs font-label">Edit</button>
                        <button
                          type="button"
                          onClick={() => setDeleteCandidate(doc)}
                          className="text-xs font-label text-red-400 hover:text-red-300"
                        >
                          <span className="sr-only">Delete project document {doc.title}</span>
                          <span aria-hidden="true">Delete</span>
                        </button>
                      </div>
                    </div>
                  ))}
                  {deleteCandidate && (
                    <div
                      role="alertdialog"
                      aria-modal="true"
                      aria-label={`Delete project document "${deleteCandidate.title}"?`}
                      className="rounded-[var(--radius-card)] border border-red-500/30 bg-red-500/10 p-4 shadow-sm"
                    >
                      <p className="text-sm font-label text-[var(--color-pib-text)]">
                        Delete project document &quot;{deleteCandidate.title}&quot;?
                      </p>
                      <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                        This removes the document from the project workspace. Tasks, comments, and project history stay intact.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={confirmDeleteDoc}
                          className="rounded-[var(--radius-btn)] bg-red-500 px-3 py-2 text-xs font-label text-white transition-colors hover:bg-red-400"
                        >
                          Confirm delete project document {deleteCandidate.title}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteCandidate(null)}
                          className="pib-btn-secondary text-xs font-label"
                        >
                          Keep document
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="pib-surface min-h-[320px] p-5">
                  {selectedDoc ? (
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <span className={`inline-block rounded-full border px-2.5 py-1 text-[10px] font-label uppercase tracking-widest ${TYPE_COLORS[selectedDoc.type] || TYPE_COLORS.notes}`}>{selectedDoc.type}</span>
                          <h3 className="mt-3 text-xl font-headline font-bold text-[var(--color-pib-text)]">{selectedDoc.title}</h3>
                          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Updated {formatDate(selectedDoc.updatedAt ?? selectedDoc.createdAt)}</p>
                        </div>
                        <button onClick={() => onEditDoc(selectedDoc)} className="pib-btn-secondary text-xs font-label">Edit</button>
                      </div>
                      <div className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-[var(--radius-btn)] border border-[var(--color-pib-line)] bg-[var(--color-card)] p-4 text-sm leading-6 text-[var(--color-pib-text)]">
                        {projectDocContent(selectedDoc.content) || 'This document is empty.'}
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
                      <span className="material-symbols-outlined text-[40px] text-[var(--color-pib-text-muted)]">preview</span>
                      <h3 className="mt-3 text-base font-headline font-bold text-[var(--color-pib-text)]">Select a document</h3>
                      <p className="mt-2 max-w-xs text-sm text-[var(--color-pib-text-muted)]">Click a document on the left to open its preview here.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-pib-line)] bg-[var(--color-background)] p-8 text-center">
                <span className="material-symbols-outlined text-[40px] text-[var(--color-pib-text-muted)]">draft</span>
                <h3 className="mt-3 text-base font-headline font-bold text-[var(--color-pib-text)]">No documents yet</h3>
                <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">Create the first project note, brief, requirement, or reference doc.</p>
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
