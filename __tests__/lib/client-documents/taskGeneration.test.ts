import { createBlocksFromTemplate } from '@/lib/client-documents/templates'
import { buildApprovedDocumentTaskFanout } from '@/lib/client-documents/taskGeneration'
import type { ClientDocument, DocumentBlock } from '@/lib/client-documents/types'

describe('buildApprovedDocumentTaskFanout', () => {
  const document = {
    id: 'doc-1',
    orgId: 'org-1',
    title: 'Internal System Spec',
    type: 'build_spec',
    templateId: 'build_spec',
    status: 'approved',
    linked: {
      projectId: 'project-1',
      geoWorkspaceId: 'geo-workspace-1',
      geoAuditId: 'geo-audit-1',
      geoTaskIds: ['geo-task-1'],
      seoSprintId: 'seo-sprint-1',
      campaignId: 'campaign-1',
    },
    currentVersionId: 'version-1',
    latestPublishedVersionId: 'version-1',
    approvalMode: 'operational',
    clientPermissions: { canComment: true, canSuggest: true, canDirectEdit: false, canApprove: true },
    assumptions: [],
    shareToken: 'share-token',
    shareEnabled: false,
    editShareEnabled: false,
    createdBy: 'pip',
    createdByType: 'agent',
    updatedBy: 'pip',
    updatedByType: 'agent',
    deleted: false,
  } satisfies ClientDocument

  const blocks: DocumentBlock[] = [
    {
      id: 'overview',
      type: 'summary',
      title: 'Overview',
      content: 'Build an approval-gated task generator for system specs.',
      required: true,
      display: {},
    },
    {
      id: 'backend',
      type: 'scope',
      title: 'Backend implementation',
      content: ['Create API flow', 'Persist linked generated tasks'],
      required: true,
      display: {},
    },
    {
      id: 'qa',
      type: 'risk',
      title: 'QA and release',
      content: 'Run focused tests and full build before release.',
      required: true,
      display: {},
    },
  ]

  it('creates pending agent tasks linked to the approved document and inherited section context', () => {
    const result = buildApprovedDocumentTaskFanout({
      document,
      versionId: 'version-1',
      approvalId: 'approval-1',
      blocks,
      actorId: 'ai-agent',
      now: 1_700_000_000_000,
      taskRefs: ['task-backend', 'task-qa'],
      plan: {
        tasks: [
          {
            key: 'backend',
            title: 'Implement approved spec backend',
            sectionId: 'backend',
            assigneeAgentId: 'theo',
            priority: 'high',
          },
          {
            key: 'qa',
            title: 'Review generated task flow',
            sectionId: 'qa',
            assigneeAgentId: 'pip',
            dependsOn: ['backend'],
          },
        ],
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.projectId).toBe('project-1')
    expect(result.createdTaskIds).toEqual(['task-backend', 'task-qa'])
    expect(result.tasks[0]).toMatchObject({
      id: 'task-backend',
      projectId: 'project-1',
      orgId: 'org-1',
      title: 'Implement approved spec backend',
      priority: 'high',
      assigneeAgentId: 'theo',
      reviewerAgentId: 'qa-release',
      riskLevel: 'high',
      requiredCapability: 'engineering',
      expectedArtifacts: ['commit', 'test-output', 'build-output', 'preview-url'],
      approvalGateTaskId: 'approval-1',
      agentStatus: 'pending',
      sourceDocumentId: 'doc-1',
      sourceDocumentVersionId: 'version-1',
      sourceSpecVersion: 'version-1',
      sourceDocumentSectionId: 'backend',
    })
    expect(result.tasks[0].labels).toEqual(expect.arrayContaining([
      'generated-from-approved-spec',
      'document:doc-1',
      'document-section:backend',
    ]))
    expect(result.tasks[0].linkedDocuments).toEqual([
      expect.objectContaining({ type: 'client-document', ref: 'doc-1', versionId: 'version-1', approvalId: 'approval-1' }),
    ])
    expect(result.tasks[0].linkedArtifacts).toEqual(expect.arrayContaining([
      { type: 'campaign', ref: 'campaign-1', label: 'Linked campaign' },
      { type: 'seo-sprint', ref: 'seo-sprint-1', label: 'Linked SEO sprint' },
      { type: 'geo-workspace', ref: 'geo-workspace-1', label: 'Linked GEO workspace' },
      { type: 'geo-audit', ref: 'geo-audit-1', label: 'Linked GEO audit' },
      { type: 'geo-task', ref: 'geo-task-1', label: 'Linked GEO task' },
    ]))
    expect(result.tasks[0].agentInput).toMatchObject({
      spec: expect.stringContaining('Implement approved spec backend'),
      context: {
        orgId: 'org-1',
        projectId: 'project-1',
        linkedRecords: document.linked,
        documentId: 'doc-1',
        documentTitle: 'Internal System Spec',
        documentVersionId: 'version-1',
        approvalId: 'approval-1',
        section: {
          id: 'backend',
          type: 'scope',
          title: 'Backend implementation',
          content: ['Create API flow', 'Persist linked generated tasks'],
        },
      },
    })
    expect(result.tasks[1].dependsOn).toEqual(['task-backend'])
  })

  it('uses the GEO SEO template workflow when an approved GEO strategy has no custom task plan', () => {
    const result = buildApprovedDocumentTaskFanout({
      document: {
        ...document,
        type: 'geo_seo_strategy',
        title: 'GEO SEO Strategy',
        templateId: 'geo-seo-strategy-v1',
      },
      versionId: 'version-1',
      approvalId: 'approval-1',
      blocks: createBlocksFromTemplate('geo_seo_strategy'),
      actorId: 'ai-agent',
      taskRefs: ['task-sage-research', 'task-maya-draft', 'task-approval', 'task-maya-execute', 'task-delta'],
      plan: {},
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.tasks.map((task) => [task.title, task.assigneeAgentId, task.dependsOn ?? []])).toEqual([
      ['Sage: research GEO SEO opportunities', 'sage', []],
      ['Maya: draft GEO-informed content plan and assets', 'maya', ['task-sage-research']],
      ['Pip: secure client approval for GEO content execution', 'pip', ['task-maya-draft']],
      ['Maya: execute approved GEO content and distribution', 'maya', ['task-approval']],
      ['Sage: review GEO delta and next opportunities', 'sage', ['task-maya-execute']],
    ])
    expect(result.tasks[0].labels).toEqual(expect.arrayContaining(['geo-record-required', 'seo-overlap-check']))
    expect(result.tasks[1].labels).toEqual(expect.arrayContaining(['seo-content-link', 'client-approval-required']))
    expect(result.tasks[3].labels).toEqual(expect.arrayContaining(['approved-only', 'linked-artifacts-required']))
  })

  it('uses implementation-ready default chains for approved build specs', () => {
    const result = buildApprovedDocumentTaskFanout({
      document,
      versionId: 'version-1',
      approvalId: 'gate-task-1',
      blocks: createBlocksFromTemplate('build_spec'),
      actorId: 'ai-agent',
      taskRefs: ['task-build', 'task-qa', 'task-release'],
      plan: {},
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.tasks.map((task) => [task.title, task.assigneeAgentId, task.dependsOn ?? []])).toEqual([
      ['Theo: implement approved build spec', 'theo', ['gate-task-1']],
      ['QA: verify approved build spec implementation', 'qa-release', ['task-build']],
      ['Pip: prepare client handoff and release decision', 'pip', ['task-qa']],
    ])
    expect(result.tasks[0]).toMatchObject({
      reviewerAgentId: 'qa-release',
      riskLevel: 'high',
      requiredCapability: 'engineering',
      expectedArtifacts: ['commit', 'test-output', 'build-output', 'preview-url'],
      approvalGateTaskId: 'gate-task-1',
      sourceDocumentId: 'doc-1',
      sourceDocumentSectionId: 'scope',
      sourceSpecVersion: 'version-1',
    })
  })

  it('uses implementation-ready default chains for approved change requests', () => {
    const result = buildApprovedDocumentTaskFanout({
      document: {
        ...document,
        id: 'change-doc-1',
        title: 'Approved Change Request',
        type: 'change_request',
        templateId: 'change-request-v1',
      },
      versionId: 'version-2',
      approvalId: 'gate-task-2',
      blocks: createBlocksFromTemplate('change_request'),
      actorId: 'ai-agent',
      taskRefs: ['task-change', 'task-change-qa', 'task-change-handoff'],
      plan: {},
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.tasks.map((task) => [task.title, task.assigneeAgentId, task.dependsOn ?? []])).toEqual([
      ['Theo: implement approved change request', 'theo', ['gate-task-2']],
      ['QA: verify approved change request', 'qa-release', ['task-change']],
      ['Pip: update scope/timeline handoff after change request', 'pip', ['task-change-qa']],
    ])
    expect(result.tasks[0]).toMatchObject({
      riskLevel: 'high',
      requiredCapability: 'engineering',
      approvalGateTaskId: 'gate-task-2',
      sourceSpecVersion: 'version-2',
    })
  })

  it('creates decision and recommendation follow-ups from an approved research report instead of blind code work', () => {
    const result = buildApprovedDocumentTaskFanout({
      document: {
        ...document,
        id: 'research-doc-1',
        title: 'Audience Research Report',
        type: 'research_report',
        templateId: 'research-report-v1',
        linked: {
          ...document.linked,
          researchItemIds: ['research-item-1'],
        },
      },
      versionId: 'version-1',
      approvalId: 'approval-1',
      blocks: createBlocksFromTemplate('research_report'),
      actorId: 'ai-agent',
      taskRefs: ['task-decision', 'task-recommendations'],
      plan: {},
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.tasks.map((task) => [task.title, task.assigneeAgentId, task.dependsOn ?? []])).toEqual([
      ['Pip: record decision from approved research report', 'pip', ['approval-1']],
      ['Sage: convert approved research recommendations into next-step options', 'sage', ['task-decision']],
    ])
    expect(result.tasks[0]).toMatchObject({
      requiredCapability: 'decision-routing',
      riskLevel: 'medium',
      expectedArtifacts: ['decision-record', 'project-comment-or-task-links'],
      approvalGateTaskId: 'approval-1',
      sourceResearchItemId: 'research-item-1',
    })
    expect(result.tasks[1]).toMatchObject({
      requiredCapability: 'research-recommendation-followup',
      reviewerAgentId: 'pip',
    })
    expect(result.tasks.some((task) => task.assigneeAgentId === 'theo')).toBe(false)
  })

  it('rejects generation unless the document has a linked project', () => {
    const result = buildApprovedDocumentTaskFanout({
      document: { ...document, id: 'doc-1', linked: {} },
      versionId: 'version-1',
      approvalId: 'approval-1',
      blocks,
      actorId: 'ai-agent',
      taskRefs: ['task-1'],
      plan: { tasks: [{ key: 'backend', title: 'Build backend', sectionId: 'backend', assigneeAgentId: 'theo' }] },
    })

    expect(result).toEqual({ ok: false, error: 'Document must be linked to a project before tasks can be generated', status: 400 })
  })
})
