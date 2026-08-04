'use client'

import { useCallback, useEffect, useState } from 'react'
import { scopedApiPath } from '@/lib/portal/scoped-routing'
import { usePortalOrgScope } from '@/lib/portal/usePortalOrgScope'
import {
  type AccountingBook,
  type LegalEntity,
  readFinanceJson,
} from '@/components/finance/financeWorkbench'

export function useFinanceBookScope() {
  const orgScope = usePortalOrgScope()
  const orgId = orgScope.orgId || ''

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [entities, setEntities] = useState<LegalEntity[]>([])
  const [books, setBooks] = useState<AccountingBook[]>([])
  const [selectedEntityId, setSelectedEntityId] = useState('')
  const [selectedBookId, setSelectedBookId] = useState('')

  const foundationQuery = useCallback((resource: string, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ resource, ...extra })
    if (orgId) params.set('orgId', orgId)
    return scopedApiPath(`/api/v1/finance/foundation/queries?${params.toString()}`, orgScope)
  }, [orgId, orgScope])

  const refresh = useCallback(async () => {
    if (!orgId) {
      setError('Select an organisation workspace before opening Finance.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const entityRes = await fetch(foundationQuery('legal-entities'), { credentials: 'include' })
      const entityBody = await readFinanceJson(entityRes)
      const nextEntities = (entityBody?.data?.result ?? []) as LegalEntity[]
      setEntities(nextEntities)
      const preferredEntity =
        selectedEntityId && nextEntities.some((e) => e.id === selectedEntityId)
          ? selectedEntityId
          : nextEntities[0]?.id || ''
      setSelectedEntityId(preferredEntity)
      if (!preferredEntity) {
        setBooks([])
        setSelectedBookId('')
        return
      }
      const booksRes = await fetch(foundationQuery('books', { legalEntityId: preferredEntity }), {
        credentials: 'include',
      })
      const booksBody = await readFinanceJson(booksRes)
      const nextBooks = (booksBody?.data?.result ?? []) as AccountingBook[]
      setBooks(nextBooks)
      const preferredBook =
        selectedBookId && nextBooks.some((b) => b.id === selectedBookId)
          ? selectedBookId
          : nextBooks[0]?.id || ''
      setSelectedBookId(preferredBook)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load finance scope')
    } finally {
      setLoading(false)
    }
  }, [foundationQuery, orgId, selectedBookId, selectedEntityId])

  useEffect(() => {
    void refresh()
  }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps -- initial + org change only

  useEffect(() => {
    if (!orgId || !selectedEntityId) return
    void (async () => {
      try {
        const booksRes = await fetch(foundationQuery('books', { legalEntityId: selectedEntityId }), {
          credentials: 'include',
        })
        const booksBody = await readFinanceJson(booksRes)
        const nextBooks = (booksBody?.data?.result ?? []) as AccountingBook[]
        setBooks(nextBooks)
        if (!nextBooks.some((b) => b.id === selectedBookId)) {
          setSelectedBookId(nextBooks[0]?.id || '')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load books')
      }
    })()
  }, [selectedEntityId]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedEntity = entities.find((e) => e.id === selectedEntityId)
  const selectedBook = books.find((b) => b.id === selectedBookId)
  const scopeReady = Boolean(orgId && selectedEntityId && selectedBookId)

  async function runCommand(path: string, operation: string, command: Record<string, unknown>) {
    const res = await fetch(scopedApiPath(path, orgScope), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(orgId ? { 'X-Org-Id': orgId } : {}),
      },
      body: JSON.stringify({
        operation,
        command: {
          ...command,
          orgId,
          legalEntityId: selectedEntityId,
          bookId: selectedBookId,
        },
      }),
    })
    const body = await readFinanceJson(res)
    return body?.data?.result
  }

  function queryUrl(basePath: string, resource: string, extra: Record<string, string> = {}) {
    const params = new URLSearchParams({
      resource,
      legalEntityId: selectedEntityId,
      bookId: selectedBookId,
      ...extra,
    })
    if (orgId) params.set('orgId', orgId)
    return scopedApiPath(`${basePath}?${params.toString()}`, orgScope)
  }

  return {
    orgId,
    orgScope,
    loading,
    error,
    setError,
    message,
    setMessage,
    entities,
    books,
    selectedEntityId,
    setSelectedEntityId,
    selectedBookId,
    setSelectedBookId,
    // Convenience aliases used by phase-2/3 workbench pages
    legalEntityId: selectedEntityId,
    bookId: selectedBookId,
    selectedEntity,
    selectedBook,
    scopeReady,
    refresh,
    runCommand,
    queryUrl,
    foundationQuery,
  }
}
