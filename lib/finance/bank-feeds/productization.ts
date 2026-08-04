/**
 * Phase 6 bank-feed productization helpers.
 * Daily operator path: connection health, multi-account feeds, recon centre aging,
 * safe bulk accept/dismiss. Never auto-posts journals; never initiates payments.
 */

import type {
  BankFeedAccountFeed,
  BankFeedAgingBucket,
  BankFeedBankLine,
  BankFeedConnection,
  BankFeedConnectionHealth,
  BankFeedHealthStatus,
  BankFeedReconCentre,
  BankFeedReconCentreItem,
  BankFeedSuggestion,
} from './types'

export const SAFE_BULK_ACCEPT_MIN_CONFIDENCE = 0.8
export const STALE_SYNC_HOURS = 48

export function daysBetweenIsoDates(fromIsoDate: string, toIsoDate: string): number {
  const from = Date.parse(`${fromIsoDate.slice(0, 10)}T12:00:00.000Z`)
  const to = Date.parse(`${toIsoDate.slice(0, 10)}T12:00:00.000Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0
  return Math.max(0, Math.floor((to - from) / 86_400_000))
}

export function agingBucketForDays(days: number): BankFeedAgingBucket {
  if (days <= 7) return '0-7'
  if (days <= 30) return '8-30'
  if (days <= 60) return '31-60'
  return '61+'
}

export function isSafeBulkAcceptSuggestion(suggestion: Pick<BankFeedSuggestion, 'kind' | 'confidence' | 'reason' | 'status'>): boolean {
  if (suggestion.status !== 'pending') return false
  if (suggestion.kind === 'flag_review') return false
  if (suggestion.confidence < SAFE_BULK_ACCEPT_MIN_CONFIDENCE) return false
  const hay = `${suggestion.reason || ''}`.toLowerCase()
  if (hay.includes('sars') || hay.includes('paye') || hay.includes('payment initiation')) return false
  return true
}

/** Derive operator-facing health from connection + clock (pure). */
export function computeConnectionHealth(
  connection: Pick<
    BankFeedConnection,
    'status' | 'lastSyncAt' | 'lastError' | 'linkedAccounts' | 'externalAccountId'
  >,
  nowIso: string,
  staleHours = STALE_SYNC_HOURS,
): BankFeedConnectionHealth {
  if (connection.status === 'disconnected') {
    return {
      status: 'disconnected',
      label: 'Disconnected',
      detail: 'Reconnect or create a new mock connection. File import remains available under Statements.',
      needsReconnect: true,
      lastSyncAt: connection.lastSyncAt,
      lastError: connection.lastError,
    }
  }
  if (connection.status === 'draft') {
    return {
      status: 'draft',
      label: 'Draft',
      detail: 'Finish linking provider accounts before daily sync.',
      needsReconnect: false,
      lastSyncAt: connection.lastSyncAt,
      lastError: connection.lastError,
    }
  }
  if (connection.status === 'syncing') {
    return {
      status: 'syncing',
      label: 'Syncing',
      detail: 'Feed sync in progress — suggestions stay human-gated.',
      needsReconnect: false,
      lastSyncAt: connection.lastSyncAt,
      lastError: connection.lastError,
    }
  }
  if (connection.status === 'error' || connection.lastError) {
    return {
      status: 'error',
      label: 'Error',
      detail: connection.lastError || 'Last sync failed — reconnect or retry Sync now.',
      needsReconnect: true,
      lastSyncAt: connection.lastSyncAt,
      lastError: connection.lastError,
    }
  }

  const accountError = (connection.linkedAccounts || []).some((a) => a.status === 'error' || a.lastError)
  if (accountError) {
    const first = (connection.linkedAccounts || []).find((a) => a.status === 'error' || a.lastError)
    return {
      status: 'error',
      label: 'Account error',
      detail: first?.lastError || 'One or more linked accounts need attention.',
      needsReconnect: true,
      lastSyncAt: connection.lastSyncAt,
      lastError: first?.lastError || connection.lastError,
    }
  }

  if (!connection.lastSyncAt && !(connection.linkedAccounts || []).some((a) => a.lastSyncAt)) {
    return {
      status: 'needs_reconnect',
      label: 'Never synced',
      detail: 'Run Sync now to pull mock SA lines into recon centre (no auto-post).',
      needsReconnect: false,
      lastSyncAt: undefined,
      lastError: undefined,
    }
  }

  const last = connection.lastSyncAt ||
    (connection.linkedAccounts || [])
      .map((a) => a.lastSyncAt)
      .filter(Boolean)
      .sort()
      .slice(-1)[0]
  if (last) {
    const ageMs = Date.parse(nowIso) - Date.parse(last)
    if (Number.isFinite(ageMs) && ageMs > staleHours * 3_600_000) {
      return {
        status: 'stale',
        label: 'Stale',
        detail: `Last sync older than ${staleHours}h — refresh feed before close.`,
        needsReconnect: false,
        lastSyncAt: last,
        lastError: undefined,
      }
    }
  }

  if (!connection.externalAccountId && !(connection.linkedAccounts || []).some((a) => a.status === 'active')) {
    return {
      status: 'needs_reconnect',
      label: 'No active account',
      detail: 'Link at least one provider account to a PiB bank account.',
      needsReconnect: true,
      lastSyncAt: last,
      lastError: undefined,
    }
  }

  return {
    status: 'healthy',
    label: 'Healthy',
    detail: 'Connection ready for daily operator sync. Accept/dismiss remains human-only.',
    needsReconnect: false,
    lastSyncAt: last,
    lastError: undefined,
  }
}

export function buildAccountFeedFromProvider(input: {
  externalAccountId: string
  name: string
  currency: string
  maskedAccountNumber?: string
  accountType?: BankFeedAccountFeed['accountType']
  bankAccountId: string
  status?: BankFeedAccountFeed['status']
  cursor?: string
  lastSyncAt?: string
  lastSyncRunId?: string
  lastError?: string
}): BankFeedAccountFeed {
  return {
    externalAccountId: input.externalAccountId,
    name: input.name,
    currency: input.currency.toUpperCase(),
    bankAccountId: input.bankAccountId,
    status: input.status || 'active',
    ...(input.maskedAccountNumber ? { maskedAccountNumber: input.maskedAccountNumber } : {}),
    ...(input.accountType ? { accountType: input.accountType } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.lastSyncAt ? { lastSyncAt: input.lastSyncAt } : {}),
    ...(input.lastSyncRunId ? { lastSyncRunId: input.lastSyncRunId } : {}),
    ...(input.lastError ? { lastError: input.lastError } : {}),
  }
}

/** Ensure legacy single-account connections expose a linkedAccounts list for UI. */
export function normalizeLinkedAccounts(connection: BankFeedConnection): BankFeedAccountFeed[] {
  if (connection.linkedAccounts && connection.linkedAccounts.length > 0) {
    return connection.linkedAccounts.map((a) => ({ ...a }))
  }
  if (!connection.externalAccountId) return []
  return [
    buildAccountFeedFromProvider({
      externalAccountId: connection.externalAccountId,
      name: connection.label || connection.externalAccountId,
      currency: 'ZAR',
      bankAccountId: connection.bankAccountId,
      status: connection.status === 'disconnected' ? 'disconnected' : connection.status === 'error' ? 'error' : 'active',
      cursor: connection.cursor,
      lastSyncAt: connection.lastSyncAt,
      lastSyncRunId: connection.lastSyncRunId,
      lastError: connection.lastError,
    }),
  ]
}

export function markLinesMaterialized(
  lines: BankFeedBankLine[],
  nowIso: string,
): BankFeedBankLine[] {
  return lines.map((line) => {
    if (line.importStatus !== 'imported' && line.importStatus !== 'staged') return line
    if (line.reconMaterializedAt) return line
    return {
      ...line,
      reconMaterializedAt: nowIso,
      reconState: line.reconState || 'unreconciled',
      version: line.version + 1,
    }
  })
}

/** Shape bank-rules evaluate can consume (human-gated continuity). */
export function toBankRulesEvaluatePayload(lines: BankFeedBankLine[]): Array<{
  id: string
  amountMinor: number
  description: string
  reference?: string
  counterpartyName?: string
  reconciliationState: string
}> {
  return lines
    .filter((l) => l.importStatus === 'imported' || l.importStatus === 'staged')
    .map((l) => ({
      id: l.bankTransactionId || l.id,
      amountMinor: l.amountMinor,
      description: l.description,
      ...(l.reference ? { reference: l.reference } : {}),
      ...(l.counterpartyName ? { counterpartyName: l.counterpartyName } : {}),
      reconciliationState: l.reconState === 'suggestion_accepted' ? 'matched' : 'unmatched',
    }))
}

export function buildReconCentre(input: {
  orgId: string
  legalEntityId: string
  bookId: string
  asOfIso: string
  lines: BankFeedBankLine[]
  suggestions: BankFeedSuggestion[]
  connections: BankFeedConnection[]
}): BankFeedReconCentre {
  const suggestionByLine = new Map<string, BankFeedSuggestion>()
  for (const s of input.suggestions) {
    const prev = suggestionByLine.get(s.bankLineId)
    if (!prev || s.createdAt >= prev.createdAt) suggestionByLine.set(s.bankLineId, s)
  }

  const items: BankFeedReconCentreItem[] = []
  for (const line of input.lines) {
    if (line.orgId !== input.orgId || line.legalEntityId !== input.legalEntityId || line.bookId !== input.bookId) {
      continue
    }
    if (line.importStatus === 'duplicate' || line.importStatus === 'error') continue
    const suggestion = suggestionByLine.get(line.id)
    const accepted = suggestion?.status === 'accepted'
    if (accepted) continue // treated as cleared from operator unreconciled queue

    const agingDays = daysBetweenIsoDates(line.effectiveDate, input.asOfIso)
    const bucket = agingBucketForDays(agingDays)
    const safeBulkAccept = suggestion ? isSafeBulkAcceptSuggestion(suggestion) : false
    items.push({
      bankLineId: line.id,
      connectionId: line.connectionId,
      externalAccountId: line.externalAccountId,
      bankAccountId: line.bankAccountId,
      bankTransactionId: line.bankTransactionId,
      effectiveDate: line.effectiveDate,
      description: line.description,
      amountMinor: line.amountMinor,
      currency: line.currency,
      importStatus: line.importStatus,
      agingDays,
      agingBucket: bucket,
      suggestionId: suggestion?.id,
      suggestionKind: suggestion?.kind,
      suggestionStatus: suggestion?.status,
      suggestionConfidence: suggestion?.confidence,
      safeBulkAccept,
      reconState:
        suggestion?.status === 'pending'
          ? 'suggestion_pending'
          : suggestion?.status === 'dismissed'
            ? 'suggestion_dismissed'
            : line.reconState || 'unreconciled',
      materializedAt: line.reconMaterializedAt,
      autoPosted: false,
      externalPaymentInitiated: false,
    })
  }

  items.sort((a, b) => {
    if (b.agingDays !== a.agingDays) return b.agingDays - a.agingDays
    return b.effectiveDate.localeCompare(a.effectiveDate)
  })

  const buckets: BankFeedAgingBucket[] = ['0-7', '8-30', '31-60', '61+']
  const aging = buckets.map((bucket) => {
    const rows = items.filter((i) => i.agingBucket === bucket)
    return {
      bucket,
      count: rows.length,
      amountMinor: rows.reduce((sum, r) => sum + r.amountMinor, 0),
    }
  })

  const pendingSuggestions = input.suggestions.filter(
    (s) =>
      s.orgId === input.orgId &&
      s.legalEntityId === input.legalEntityId &&
      s.bookId === input.bookId &&
      s.status === 'pending',
  )
  const safeBulkAcceptIds = pendingSuggestions.filter(isSafeBulkAcceptSuggestion).map((s) => s.id)
  const connectionHealth = input.connections
    .filter((c) => c.orgId === input.orgId && c.legalEntityId === input.legalEntityId && c.bookId === input.bookId)
    .map((c) => ({
      connectionId: c.id,
      label: c.label,
      health: computeConnectionHealth(c, input.asOfIso),
      accounts: normalizeLinkedAccounts(c),
    }))

  return {
    asOf: input.asOfIso,
    unreconciledCount: items.length,
    pendingSuggestionCount: pendingSuggestions.length,
    aging,
    items,
    safeBulkAcceptIds,
    pendingSuggestionIds: pendingSuggestions.map((s) => s.id),
    connectionHealth,
    fileImportFallbackPath: '/portal/finance/statements',
    hardGates: {
      noEgress: true,
      autoPosted: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
      sarsSubmissionInitiated: false,
    },
  }
}

export function healthTone(status: BankFeedHealthStatus): 'live' | 'warning' | 'danger' | 'default' | 'accent' {
  if (status === 'healthy') return 'live'
  if (status === 'syncing') return 'accent'
  if (status === 'stale') return 'warning'
  if (status === 'error' || status === 'needs_reconnect' || status === 'disconnected') return 'danger'
  return 'default'
}
