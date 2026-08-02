// lib/crm/facts — ContactFact evidence ledger (Comp AI pattern, multi-tenant PiB)

export * from './types'
export * from './evidence'
export * from './fields'
export {
  listContactFacts,
  getFactById,
  CONTACT_FACTS_COLLECTION,
  serializeFact,
} from './store'
export {
  loadAccessibleFactContact,
  type ContactAccessResult,
} from './access'
export {
  recordContactFact,
  decideContactFact,
  humanOwnedFieldsAfterHumanEdit,
} from './record'
export {
  parseMailboxEvidence,
  isolateSignatureRegion,
  type MailboxFactCandidate,
  type ParseMailboxEvidenceInput,
} from './mailbox-evidence'
export {
  applyMailboxFactsToContact,
  type ApplyMailboxFactsInput,
  type ApplyMailboxFactsResult,
} from './apply-mailbox'
export {
  scheduleRecheck,
  listResearchTasks,
  listLeasableResearchTasks,
  leaseNextResearchTask,
  completeResearchTask,
  CRM_RESEARCH_TASKS_COLLECTION,
  type CrmResearchTask,
  type ScheduleRecheckInput,
  type ResearchTaskStatus,
  type ResearchTaskKind,
} from './research-tasks'
export {
  listGlobalLeasableResearchTasks,
  leaseResearchTaskById,
  leaseNextResearchTaskGlobal,
  processLeasedResearchTask,
  workNextResearchTaskForOrg,
  runResearchTaskWorkerBatch,
  type ProcessResearchTaskResult,
  type ResearchWorkerBatchResult,
} from './research-worker'
export {
  loadContactGraph,
  loadCompanyGraph,
  loadDealGraph,
  type ContactGraphPayload,
  type CompanyGraphPayload,
  type DealGraphPayload,
  type CrmGraphNeighbour,
} from './graph'
export {
  recordJobChange,
  type RecordJobChangeInput,
  type RecordJobChangeResult,
} from './job-change'
