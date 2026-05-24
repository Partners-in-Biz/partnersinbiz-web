import { getClientDocumentTemplate } from './templates'
import type { ClientDocumentType } from './types'

export type ClientDocumentAiPromptSection =
  | 'evidence'
  | 'confidence'
  | 'contradictions'
  | 'decisions'
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
  'evidence',
  'confidence',
  'contradictions',
  'decisions',
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
  'Evidence: list the specific facts, sources, observations, or artifacts that support each finding.',
  'Confidence: assign a confidence level to each major finding and explain why it is not higher.',
  'Contradictions: call out disputed, stale, weak, or conflicting evidence instead of smoothing it over.',
  'Decisions: separate decisions already made from recommendations that still need approval.',
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
