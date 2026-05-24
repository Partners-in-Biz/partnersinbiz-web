import { getClientDocumentTemplate } from './templates'
import type { ClientDocumentType } from './types'

export type ClientDocumentAiPromptSection =
  | 'researchQuestion'
  | 'contextHypothesis'
  | 'methodology'
  | 'sourceLedger'
  | 'findings'
  | 'confidence'
  | 'contradictionsUnknowns'
  | 'recommendations'
  | 'evidenceAppendix'
  | 'decisionNeeded'
  | 'requirements'
  | 'technicalApproach'
  | 'apiDataChanges'
  | 'tests'
  | 'rollback'
  | 'taskBreakdown'
  | 'summary'
  | 'recommendedContent'
  | 'approvalNotes'

export type ClientDocumentAiPromptContractKind = 'research' | 'engineering' | 'general'

export interface ClientDocumentAiPromptContract {
  key: string
  kind: ClientDocumentAiPromptContractKind
  purpose: string
  requiredSections: ClientDocumentAiPromptSection[]
  instructions: string[]
}

export interface BuildClientDocumentAiPromptInput {
  documentType: ClientDocumentType
  title: string
  sourceMaterial: string
}

const RESEARCH_REQUIRED_SECTIONS: ClientDocumentAiPromptSection[] = [
  'researchQuestion',
  'contextHypothesis',
  'methodology',
  'sourceLedger',
  'findings',
  'confidence',
  'contradictionsUnknowns',
  'recommendations',
  'evidenceAppendix',
  'decisionNeeded',
]

const ENGINEERING_REQUIRED_SECTIONS: ClientDocumentAiPromptSection[] = [
  'requirements',
  'technicalApproach',
  'apiDataChanges',
  'tests',
  'rollback',
  'taskBreakdown',
]

const GENERAL_REQUIRED_SECTIONS: ClientDocumentAiPromptSection[] = [
  'summary',
  'recommendedContent',
  'approvalNotes',
]

const RESEARCH_INSTRUCTIONS = [
  'Research question: state the exact question this report answers or the decision it supports.',
  'Context / hypothesis: explain the starting context, working hypothesis, and boundaries of the research.',
  'Methodology: describe how the evidence was gathered, screened, and synthesised.',
  'Source ledger: list each source with title, type, publisher/date where known, confidence, verification status, and URL/media reference.',
  'Findings: present evidence-backed findings only, with linked source IDs and finding-level confidence.',
  'Confidence: summarize overall confidence, verified-source coverage, and why confidence is not higher.',
  'Contradictions / unknowns: call out disputed, stale, weak, missing, or conflicting evidence instead of smoothing it over.',
  'Recommendations: separate recommended actions from findings, with source IDs and priority/status where known.',
  'Evidence appendix: preserve excerpts, raw observations, and source IDs so reviewers can audit the claims.',
  'Decision needed: state what should be decided next and whether a separate spec/change request is required before implementation tasks exist.',
]

const ENGINEERING_INSTRUCTIONS = [
  'Requirements: state the functional and non-functional requirements in implementation-ready language.',
  'Technical approach: describe the proposed code, architecture, integrations, and operational flow.',
  'API/data changes: identify routes, schemas, migrations, records, events, or permissions that must change.',
  'Tests: name the automated and manual checks needed before release.',
  'Rollback plan: explain how to disable, revert, or safely recover if the change misbehaves.',
  'Task breakdown: split the work into ordered, assignable tasks with dependencies where relevant.',
]

const GENERAL_INSTRUCTIONS = [
  'Summary: explain the requested document outcome and audience.',
  'Recommended content: draft the sections that best fit the document template.',
  'Approval notes: identify anything that needs client, operator, or specialist review.',
]

function promptKindForDocumentType(documentType: ClientDocumentType): ClientDocumentAiPromptContractKind {
  if (documentType === 'research_report') return 'research'
  if (documentType === 'build_spec' || documentType === 'change_request') return 'engineering'
  return 'general'
}

export function getClientDocumentAiPromptContract(documentType: ClientDocumentType): ClientDocumentAiPromptContract {
  const template = getClientDocumentTemplate(documentType)
  const kind = promptKindForDocumentType(documentType)

  if (kind === 'research') {
    return {
      key: template.contract.aiPromptKey,
      kind,
      purpose: 'Evidence-led research report for decision support',
      requiredSections: [...RESEARCH_REQUIRED_SECTIONS],
      instructions: [...RESEARCH_INSTRUCTIONS],
    }
  }

  if (kind === 'engineering') {
    return {
      key: template.contract.aiPromptKey,
      kind,
      purpose: 'Engineering-ready implementation specification',
      requiredSections: [...ENGINEERING_REQUIRED_SECTIONS],
      instructions: [...ENGINEERING_INSTRUCTIONS],
    }
  }

  return {
    key: template.contract.aiPromptKey,
    kind,
    purpose: 'General client document draft',
    requiredSections: [...GENERAL_REQUIRED_SECTIONS],
    instructions: [...GENERAL_INSTRUCTIONS],
  }
}

export function buildClientDocumentAiPrompt(input: BuildClientDocumentAiPromptInput): string {
  const template = getClientDocumentTemplate(input.documentType)
  const contract = getClientDocumentAiPromptContract(input.documentType)

  return [
    `Document type: ${input.documentType}`,
    `Template: ${template.label}`,
    `Prompt contract: ${contract.key}`,
    `Contract purpose: ${contract.purpose}`,
    `Title: ${input.title}`,
    '',
    'Required output sections:',
    ...contract.instructions.map((instruction) => `- ${instruction}`),
    '',
    'Source material:',
    input.sourceMaterial,
    '',
    'Return a clear document draft using only the required contract sections above. Do not invent evidence, approvals, implementation details, or dates that are not supported by the source material.',
  ].join('\n')
}
