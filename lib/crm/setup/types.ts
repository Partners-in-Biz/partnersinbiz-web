import type { Timestamp } from 'firebase-admin/firestore'
import type { PipelineStage } from '@/lib/pipelines/types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export type CrmSalesProcess = 'new_sales' | 'account_management' | 'support_led' | 'mixed'
export type CrmImportStatus = 'not_started' | 'planning' | 'importing' | 'done'
export type CrmGmailIntent = 'not_now' | 'connect_later' | 'connect_now'
export type CrmPipelinePreference = 'simple_sales' | 'consultative_sales' | 'service_delivery' | 'renewals'

export interface CrmSetupAnswers {
  salesProcess: CrmSalesProcess
  importStatus: CrmImportStatus
  gmailIntent: CrmGmailIntent
  pipelinePreference: CrmPipelinePreference
  selectedTemplateIds: string[]
  notes?: string
}

export interface CrmSetupState extends CrmSetupAnswers {
  id: string
  orgId: string
  appliedPipelineTemplateIds: string[]
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  updatedBy?: string
  updatedByRef?: MemberRef
}

export type StarterTemplateKind = 'pipeline' | 'sequence' | 'segment' | 'form'

export interface BaseStarterTemplate {
  id: string
  kind: StarterTemplateKind
  name: string
  description: string
  recommendedFor: CrmPipelinePreference[]
}

export interface PipelineStarterTemplate extends BaseStarterTemplate {
  kind: 'pipeline'
  stages: PipelineStage[]
}

export interface SequenceStarterTemplate extends BaseStarterTemplate {
  kind: 'sequence'
  steps: Array<{ delayDays: number; subject: string; purpose: string }>
}

export interface SegmentStarterTemplate extends BaseStarterTemplate {
  kind: 'segment'
  rules: string[]
}

export interface FormStarterTemplate extends BaseStarterTemplate {
  kind: 'form'
  fields: string[]
}

export type CrmStarterTemplate =
  | PipelineStarterTemplate
  | SequenceStarterTemplate
  | SegmentStarterTemplate
  | FormStarterTemplate
