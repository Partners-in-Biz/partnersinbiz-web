jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'server-timestamp'),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {},
}))

import { buildClientDocumentAiPrompt, getClientDocumentAiPromptContract } from '@/lib/client-documents/aiPromptContracts'
import { buildApprovedDocumentTaskFanout } from '@/lib/client-documents/taskGeneration'
import {
  CLIENT_DOCUMENT_TEMPLATES,
  createBlocksFromTemplate,
  getClientDocumentTemplate,
} from '@/lib/client-documents/templates'
import type { ClientDocument, DocumentBlock } from '@/lib/client-documents/types'

function document(overrides: Partial<ClientDocument> & { id?: string } = {}): ClientDocument & { id: string } {
  return {
    id: overrides.id ?? 'doc-1',
    orgId: 'org-1',
    title: 'Purpose-specific document',
    type: 'build_spec',
    templateId: 'build-spec-v1',
    status: 'internal_draft',
    linked: { projectId: 'project-1' },
    currentVersionId: 'version-1',
    approvalMode: 'operational',
    clientPermissions: { canComment: true, canSuggest: true, canDirectEdit: false, canApprove: true },
    assumptions: [],
    shareToken: 'share-token',
    shareEnabled: false,
    deleted: false,
    createdAt: 'created',
    createdBy: 'agent:pip',
    createdByType: 'agent',
    updatedAt: 'updated',
    updatedBy: 'agent:pip',
    updatedByType: 'agent',
    ...overrides,
  } as ClientDocument & { id: string }
}

function ids(blocks: DocumentBlock[]) {
  return blocks.map((block) => block.id)
}

describe('purpose-specific client document templates', () => {
  it('registers research, build-spec, and change-request contracts with distinct block shapes', () => {
    const buildSpec = getClientDocumentTemplate('build_spec')
    const research = getClientDocumentTemplate('research_report')
    const changeRequest = getClientDocumentTemplate('change_request')

    expect(CLIENT_DOCUMENT_TEMPLATES.map((template) => template.id)).toEqual(
      expect.arrayContaining(['build-spec-v1', 'research-report-v1', 'change-request-v1']),
    )

    expect(buildSpec.contract).toMatchObject({
      purpose: 'implementation_spec',
      taskFanout: 'approval_gated',
      aiPromptKey: 'client_documents.build_spec',
    })
    expect(research.contract).toMatchObject({
      purpose: 'research_presentation',
      taskFanout: 'none',
      aiPromptKey: 'client_documents.research_report',
    })
    expect(changeRequest.contract).toMatchObject({
      purpose: 'scope_change_approval',
      taskFanout: 'approval_gated',
      aiPromptKey: 'client_documents.change_request',
    })

    expect(ids(research.defaultBlocks)).toEqual([
      'research_question',
      'context_hypothesis',
      'methodology',
      'source_ledger',
      'findings',
      'confidence',
      'contradictions_unknowns',
      'recommendations',
      'evidence_appendix',
      'decision_needed',
    ])
    expect(ids(buildSpec.defaultBlocks)).not.toContain('source_ledger')
    expect(ids(buildSpec.defaultBlocks)).not.toContain('confidence')
    expect(ids(changeRequest.defaultBlocks)).toEqual(['hero', 'summary', 'scope', 'timeline', 'investment', 'approval'])
  })

  it('selects separate AI prompt contracts for research versus engineering documents', () => {
    const researchContract = getClientDocumentAiPromptContract('research_report')
    const buildContract = getClientDocumentAiPromptContract('build_spec')
    const changeContract = getClientDocumentAiPromptContract('change_request')

    expect(researchContract.kind).toBe('research')
    expect(researchContract.requiredSections).toEqual(
      expect.arrayContaining(['researchQuestion', 'sourceLedger', 'confidence', 'contradictionsUnknowns', 'decisionNeeded']),
    )
    expect(researchContract.requiredSections).not.toContain('apiDataChanges')
    expect(researchContract.requiredSections).not.toContain('rollback')

    expect(buildContract.kind).toBe('engineering')
    expect(changeContract.kind).toBe('engineering')
    expect(buildContract.requiredSections).toEqual(
      expect.arrayContaining(['requirements', 'technicalApproach', 'apiDataChanges', 'tests', 'rollback', 'taskBreakdown']),
    )
    expect(buildContract.requiredSections).not.toContain('sourceLedger')

    const researchPrompt = buildClientDocumentAiPrompt({
      documentType: 'research_report',
      title: 'Market proof',
      sourceMaterial: 'Source A says implementation is risky.',
    })
    const buildPrompt = buildClientDocumentAiPrompt({
      documentType: 'build_spec',
      title: 'Build task bus',
      sourceMaterial: 'Need a dependency-gated implementation.',
    })

    expect(researchPrompt).toContain('Prompt contract: client_documents.research_report')
    expect(researchPrompt).toContain('Source ledger')
    expect(researchPrompt).toContain('Do not invent evidence')
    expect(researchPrompt).not.toContain('API/data changes')

    expect(buildPrompt).toContain('Prompt contract: client_documents.build_spec')
    expect(buildPrompt).toContain('API/data changes')
    expect(buildPrompt).toContain('Rollback plan')
    expect(buildPrompt).not.toContain('Source ledger')
  })

  it('fans approved engineering specs into implementation tasks with dependency and reviewer metadata', () => {
    const blocks = createBlocksFromTemplate('build_spec')
    const result = buildApprovedDocumentTaskFanout({
      document: document({ type: 'build_spec', templateId: 'build-spec-v1' }),
      versionId: 'version-approved',
      approvalId: 'approval-task',
      blocks,
      plan: {},
      actorId: 'agent:pip',
      taskRefs: ['task-theo', 'task-qa', 'task-pip'],
      now: 1000,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.tasks.map((task) => task.title)).toEqual([
      'Theo: implement approved build spec',
      'QA: verify approved build spec implementation',
      'Pip: prepare client handoff and release decision',
    ])
    expect(result.tasks[0]).toMatchObject({
      id: 'task-theo',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      dependsOn: ['approval-task'],
      reviewerAgentId: 'qa-release',
      riskLevel: 'high',
      requiredCapability: 'engineering',
      expectedArtifacts: ['commit', 'test-output', 'build-output', 'preview-url'],
    })
    expect(result.tasks[1].dependsOn).toEqual(['task-theo'])
    expect(result.tasks[2].dependsOn).toEqual(['task-qa'])
    expect(result.tasks[0].agentInput).toMatchObject({
      context: {
        documentId: 'doc-1',
        sourceSpecVersion: 'version-approved',
        approvalGateTaskId: 'approval-task',
        reviewerAgentId: 'qa-release',
      },
    })
  })

  it('does not silently turn research reports into Theo code tasks', () => {
    const result = buildApprovedDocumentTaskFanout({
      document: document({
        id: 'research-doc',
        type: 'research_report',
        templateId: 'research-report-v1',
        linked: { projectId: 'project-1', researchItemIds: ['research-1'] },
      }),
      versionId: 'research-version',
      approvalId: 'approval-task',
      blocks: createBlocksFromTemplate('research_report'),
      plan: {},
      actorId: 'agent:pip',
      taskRefs: ['task-decision', 'task-recommendations'],
      now: 2000,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.tasks).toHaveLength(2)
    expect(result.tasks.map((task) => task.assigneeAgentId)).toEqual(['pip', 'sage'])
    expect(result.tasks.map((task) => task.requiredCapability)).toEqual([
      'decision-routing',
      'research-recommendation-followup',
    ])
    expect(result.tasks.some((task) => task.assigneeAgentId === 'theo')).toBe(false)
    expect(result.tasks.some((task) => String(task.requiredCapability).includes('engineering'))).toBe(false)
    expect(result.tasks[0].dependsOn).toEqual(['approval-task'])
    expect(result.tasks[1].dependsOn).toEqual(['task-decision'])
    expect(result.tasks[1]).toMatchObject({ sourceResearchItemId: 'research-1' })
  })

  it('keeps existing and legacy documents on safe template fallbacks', () => {
    expect(getClientDocumentTemplate({ templateId: 'research_report' })).toMatchObject({
      id: 'research-report-v1',
      type: 'research_report',
    })
    expect(getClientDocumentTemplate({ type: 'unknown_legacy_type', templateId: 'bespoke-old-template' })).toMatchObject({
      id: 'legacy-safe-fallback',
      label: 'Legacy Document',
      contract: expect.objectContaining({ taskFanout: 'manual', aiPromptKey: 'client_documents.legacy_safe_fallback' }),
    })
  })
})
