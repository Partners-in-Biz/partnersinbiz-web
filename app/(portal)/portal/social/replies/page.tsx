'use client'

import { Icon } from '@/components/studio'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface ReplySuggestion {
  id?: string
  topic: string
  searchQuery: string
  context: string
  draftReply: string
}

export default function RepliesPage() {
  const router = useRouter()
  const [suggestions, setSuggestions] = useState<ReplySuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchSuggestions = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/social/x/reply-suggestions')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to load suggestions')
      setSuggestions(body.data ?? [])
    } catch (err: any) {
      setError(err.message)
      setSuggestions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSuggestions()
  }, [fetchSuggestions])

  const handleUseDraft = (suggestion: ReplySuggestion) => {
    const params = new URLSearchParams({
      topic: encodeURIComponent(suggestion.topic),
      draft: encodeURIComponent(suggestion.draftReply),
    })
    router.push(`/portal/social/compose?${params.toString()}`)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <header>
          <p className="sc-tiny">Social · Replies</p>
          <h1 className="pib-page-title mt-2">Reply Suggestions</h1>
          <p className="pib-page-sub">AI-generated reply ideas for trending topics</p>
        </header>
        <button
          onClick={fetchSuggestions}
          className="btn-pib-secondary shrink-0"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="pib-card border-[var(--color-error)]/40 text-sm text-[var(--color-error)]">{error}</div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="pib-skeleton h-48" />
          ))}
        </div>
      ) : suggestions.length === 0 ? (
        <div className="pib-empty-state">
          <Icon name="forum" />
          <h2 className="pib-empty-state-title">No reply suggestions available.</h2>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {suggestions.map((suggestion, i) => (
            <div
              key={suggestion.id ?? i}
              className="pib-card space-y-4 flex flex-col"
            >
              <div className="flex items-center gap-3">
                <span>
                  <Icon name="forum" />
                </span>
                <h3 className="pib-label">
                  {suggestion.topic}
                </h3>
              </div>

              <div>
                <p className="pib-label mb-1">Search Query</p>
                <code className="font-mono text-xs text-[var(--color-pib-text-muted)] border border-[var(--color-pib-line)] px-2 py-1 rounded block">
                  {suggestion.searchQuery}
                </code>
              </div>

              {suggestion.context && (
                <div>
                  <p className="pib-label mb-1">Context</p>
                  <p className="text-xs text-[var(--color-pib-text-muted)] leading-relaxed">{suggestion.context}</p>
                </div>
              )}

              <div>
                <p className="pib-label mb-1">Draft Reply</p>
                <p className="text-xs text-[var(--color-pib-text)] leading-relaxed border border-[var(--color-pib-line)] rounded-lg px-3 py-2">
                  {suggestion.draftReply}
                </p>
              </div>

              <div className="flex-1" />

              <button
                onClick={() => handleUseDraft(suggestion)}
                className="btn-pib-primary w-full mt-auto"
              >
                Use as Draft
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
