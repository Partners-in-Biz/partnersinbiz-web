'use client'
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
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">Reply Suggestions</h1>
          <p className="text-sm text-on-surface-variant mt-1">AI-generated reply ideas for trending topics</p>
        </div>
        <button
          onClick={fetchSuggestions}
          className="px-4 py-2 rounded-lg bg-surface-container text-on-surface font-label text-sm font-medium hover:bg-surface-container-high transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-900/30 text-red-400 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-48 rounded-xl bg-surface-container animate-pulse" />
          ))}
        </div>
      ) : suggestions.length === 0 ? (
        <div className="py-16 text-center text-on-surface-variant text-sm">No reply suggestions available.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {suggestions.map((suggestion, i) => (
            <div
              key={suggestion.id ?? i}
              className="rounded-xl bg-surface-container hover:bg-surface-container-high transition-colors p-5 space-y-3 flex flex-col"
            >
              <h3 className="font-headline text-sm uppercase tracking-widest text-on-surface">
                {suggestion.topic}
              </h3>

              <div>
                <p className="text-[10px] text-on-surface-variant uppercase tracking-wide mb-1">Search Query</p>
                <code className="font-mono text-xs text-on-surface-variant bg-surface-container-high px-2 py-1 rounded block">
                  {suggestion.searchQuery}
                </code>
              </div>

              {suggestion.context && (
                <div>
                  <p className="text-[10px] text-on-surface-variant uppercase tracking-wide mb-1">Context</p>
                  <p className="text-xs text-on-surface-variant leading-relaxed">{suggestion.context}</p>
                </div>
              )}

              <div>
                <p className="text-[10px] text-on-surface-variant uppercase tracking-wide mb-1">Draft Reply</p>
                <p className="text-xs text-on-surface leading-relaxed bg-surface-container-high rounded-lg px-3 py-2">
                  {suggestion.draftReply}
                </p>
              </div>

              <div className="flex-1" />

              <button
                onClick={() => handleUseDraft(suggestion)}
                className="w-full px-4 py-2 rounded-lg bg-white text-black font-label text-sm font-medium hover:bg-white/90 transition-colors mt-auto"
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
