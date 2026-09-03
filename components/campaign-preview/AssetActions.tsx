'use client'

import React, { useState } from 'react'
import type { AssetActionsProps } from './types'

export function AssetActions({
  status,
  onApprove,
  onRequestChanges,
  onEdit,
  busy,
}: AssetActionsProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isApproved = status === 'approved' || status === 'published'

  async function handleApprove() {
    if (busy || submitting) return
    setSubmitting(true)
    try {
      await onApprove()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmitFeedback() {
    if (!feedback.trim() || submitting) return
    setSubmitting(true)
    try {
      await onRequestChanges(feedback.trim())
      setFeedback('')
      setModalOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full">
      {/* Primary actions row — always side by side at any card width */}
      <div className="flex gap-2">
        <button
          onClick={handleApprove}
          disabled={busy || submitting || isApproved}
          className={[
            'flex-1 px-3 py-2.5 rounded-lg text-sm  whitespace-nowrap transition-all',
            isApproved
              ? 'bg-emerald-600/20 text-emerald-400 cursor-default'
              : 'bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white',
            (busy || submitting) && !isApproved ? 'opacity-50 cursor-not-allowed' : '',
          ].join(' ')}
        >
          {isApproved ? '✓ Approved' : 'Approve'}
        </button>

        <button
          onClick={() => setModalOpen(true)}
          disabled={busy || submitting}
          className={[
            'flex-1 px-3 py-2.5 rounded-lg text-sm  whitespace-nowrap transition-all',
            'border border-amber-500/60 text-[var(--sc-ink-soft)] hover:bg-[var(--sc-surface)]/10 active:scale-[0.98]',
            busy || submitting ? 'opacity-50 cursor-not-allowed' : '',
          ].join(' ')}
        >
          Request Changes
        </button>
      </div>

      {/* Tertiary action — full width, clearly secondary */}
      <button
        onClick={onEdit}
        disabled={busy || submitting}
        className={[
          'w-full mt-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all',
          'border border-white/8 text-[var(--color-pib-text-muted,#8B8B92)]',
          'hover:border-white/16 hover:text-[var(--color-pib-text,#EDEDED)] active:scale-[0.98]',
          busy || submitting ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
      >
        Edit
      </button>

      {/* Request Changes modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => !submitting && setModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-[6px] p-6 space-y-4"
            style={{
              background: '#141416',
              border: '1px solid rgba(255,255,255,0.12)',
              color: '#EDEDED',
              fontFamily: 'inherit',
            }}
          >
            <div>
              <p className="text-base">Request changes</p>
              <p className="text-sm mt-1" style={{ color: '#8B8B92' }}>
                What needs to change? The team will see this feedback.
              </p>
            </div>

            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              autoFocus
              placeholder="e.g. Tighten the hook in the first sentence, swap the hero image…"
              rows={5}
              className="w-full rounded-lg text-sm resize-y focus:outline-none focus:ring-1 focus:ring-amber-500/60 p-3"
              style={{
                background: 'var(--sc-ink)',
                color: '#EDEDED',
                border: '1px solid rgba(255,255,255,0.12)',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
             aria-label="e.g. Tighten the hook in the first sentence, swap the hero image…"/>

            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setModalOpen(false)}
                disabled={submitting}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-white/10 text-[#EDEDED] hover:border-white/20 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitFeedback}
                disabled={submitting || !feedback.trim()}
                className={[
                  'px-4 py-2 rounded-lg text-sm  transition-all',
                  'bg-[var(--sc-surface)] text-[#1F1F1F] hover:bg-[var(--sc-surface)] active:scale-[0.98]',
                  submitting || !feedback.trim() ? 'opacity-50 cursor-not-allowed' : '',
                ].join(' ')}
              >
                {submitting ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AssetActions
