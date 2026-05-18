// lib/pipelines/types.ts
import type { Timestamp } from 'firebase-admin/firestore'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export type StageKind = 'open' | 'won' | 'lost'

export interface PipelineStage {
  id: string          // stable; regex ^[a-z0-9_-]{1,40}$; immutable after create
  label: string       // displayed
  kind: StageKind
  order: number
  probability: number // 0-100 integer
  color?: string      // hex
}

export interface Pipeline {
  id: string
  orgId: string
  name: string
  description?: string
  stages: PipelineStage[]
  isDefault: boolean
  archived: boolean
  createdBy?: string
  createdByRef?: MemberRef
  updatedBy?: string
  updatedByRef?: MemberRef
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  deleted?: boolean
}

export type PipelineInput = Omit<Pipeline, 'id' | 'createdAt' | 'updatedAt'>

export class PipelineValidationError extends Error {
  constructor(public details: { field: string; message: string }[]) {
    super(`Pipeline validation failed: ${details.map(d => `${d.field}: ${d.message}`).join('; ')}`)
  }
}
