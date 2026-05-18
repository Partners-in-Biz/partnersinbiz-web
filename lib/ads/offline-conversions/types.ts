// lib/ads/offline-conversions/types.ts
import type { Timestamp } from 'firebase-admin/firestore'
import type { ConversionFanoutResult } from '@/lib/ads/conversions/types'

export type BatchStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'partial'

export interface OfflineConversionBatch {
  id: string
  orgId: string
  conversionActionId: string
  csvPath: string // Firebase Storage path
  status: BatchStatus
  totalRows: number
  processedRows: number
  failedRows: number
  errorMessage?: string
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
  completedAt?: Timestamp
}

export interface OfflineConversionRow {
  id: string // doc id = eventId
  batchId: string
  eventId: string
  eventTimeIso: string
  email?: string
  phone?: string
  value?: number
  currency?: string
  gclid?: string
  ttclid?: string
  liFatId?: string
  status: 'pending' | 'sent' | 'failed' | 'skipped'
  result?: ConversionFanoutResult
  errorMessage?: string
  processedAt?: Timestamp
}
