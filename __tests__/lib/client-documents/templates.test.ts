import {
  CLIENT_DOCUMENT_TEMPLATES,
  createBlocksFromTemplate,
  getClientDocumentTemplate,
} from '@/lib/client-documents/templates'

describe('client document templates', () => {
  it('ships the approved templates including the GEO SEO workflow', () => {
    expect(CLIENT_DOCUMENT_TEMPLATES.map(template => template.type)).toEqual([
      'sales_proposal',
      'build_spec',
      'social_strategy',
      'content_campaign_plan',
      'geo_seo_strategy',
      'research_report',
      'monthly_report',
      'launch_signoff',
      'change_request',
      'canvas_draft',
    ])
  })

  it('ships an internal canvas_draft holding template for creative-canvas publishes', () => {
    const template = getClientDocumentTemplate('canvas_draft')

    expect(template.approvalMode).toBe('operational')
    expect(template.clientPermissions).toMatchObject({
      canDirectEdit: false,
      canApprove: false,
    })
    expect(template.contract.taskFanout).toBe('none')
    expect(createBlocksFromTemplate('canvas_draft').map(block => block.type)).toEqual(['summary', 'rich_text'])
  })

  it('uses formal acceptance for sales proposals', () => {
    const template = getClientDocumentTemplate('sales_proposal')

    expect(template.approvalMode).toBe('formal_acceptance')
    expect(template.clientPermissions).toMatchObject({
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    })
    expect(template.requiredBlockTypes).toContain('investment')
    expect(template.requiredBlockTypes).toContain('terms')
    expect(template.requiredBlockTypes).toContain('approval')
  })

  it('uses operational approval for launch sign-offs', () => {
    const template = getClientDocumentTemplate('launch_signoff')

    expect(template.approvalMode).toBe('operational')
    expect(template.requiredBlockTypes).toContain('approval')
  })

  it('defines a GEO SEO workflow that fans out Sage research, Maya content, and approval-gated execution', () => {
    const template = getClientDocumentTemplate('geo_seo_strategy')

    expect(template.approvalMode).toBe('operational')
    expect(template.requiredBlockTypes).toEqual(['hero', 'summary', 'scope', 'deliverables', 'timeline', 'metrics', 'approval'])
    expect(template.defaultBlocks.map(block => block.id)).toEqual([
      'hero',
      'summary',
      'scope',
      'deliverables',
      'timeline',
      'metrics',
      'approval',
    ])
    expect(template.agentWorkflowTasks?.map(task => [task.key, task.assigneeAgentId, task.dependsOn ?? []])).toEqual([
      ['sage-geo-opportunity-research', 'sage', []],
      ['maya-content-draft', 'maya', ['sage-geo-opportunity-research']],
      ['client-approval-gate', 'pip', ['maya-content-draft']],
      ['maya-execute-approved-content', 'maya', ['client-approval-gate']],
      ['sage-geo-delta-review', 'sage', ['maya-execute-approved-content']],
    ])
    expect(template.agentWorkflowTasks?.flatMap(task => task.labels ?? [])).toEqual(expect.arrayContaining([
      'geo-record-required',
      'seo-content-link',
      'approval-record-required',
      'linked-artifacts-required',
    ]))
  })

  it('creates stable block ids from template defaults', () => {
    const blocks = createBlocksFromTemplate('build_spec')

    expect(blocks.map(block => block.id)).toEqual([
      'hero',
      'summary',
      'scope',
      'deliverables',
      'timeline',
      'risk',
      'approval',
    ])
    expect(blocks.every(block => block.required)).toBe(true)
  })

  it('ships a research report template for polished client-facing research output', () => {
    const template = getClientDocumentTemplate('research_report')

    expect(template.label).toBe('Research Report')
    expect(template.approvalMode).toBe('operational')
    expect(template.requiredBlockTypes).toEqual([
      'summary',
      'problem',
      'rich_text',
      'table',
      'deliverables',
      'metrics',
      'risk',
      'callout',
      'approval',
    ])
    expect(template.defaultBlocks.map((block) => block.id)).toEqual([
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
  })

  it('exposes chooser copy that distinguishes research truth from build specs', () => {
    const research = getClientDocumentTemplate('research_report')
    const buildSpec = getClientDocumentTemplate('build_spec')
    const changeRequest = getClientDocumentTemplate('change_request')
    const labels = CLIENT_DOCUMENT_TEMPLATES.map(template => template.label)

    expect(labels).toEqual(expect.arrayContaining([
      'Research Report',
      'Website/App Build Spec',
      'Change Request',
      'Social Strategy',
      'Monthly Report',
    ]))
    expect(research.picker.decides).toContain('Research decides what is true')
    expect(research.picker.helpText).toContain('should not blindly create code tasks')
    expect(buildSpec.picker.decides).toContain('Specs decide what to build')
    expect(buildSpec.picker.bestFor).toContain('technical approach')
    expect(changeRequest.picker.description).toContain('Scoped change')
    expect(CLIENT_DOCUMENT_TEMPLATES.every(template => template.picker.description && template.picker.bestFor && template.picker.decides && template.picker.helpText)).toBe(true)
  })

  it('exposes typed metadata contracts for build specs, research reports, and change requests', () => {
    expect(getClientDocumentTemplate('build_spec').contract).toMatchObject({
      purpose: 'implementation_spec',
      approvalMode: 'operational',
      taskFanout: 'approval_gated',
      aiPromptKey: 'client_documents.build_spec',
      recommendedBlockTypes: ['hero', 'summary', 'scope', 'deliverables', 'timeline', 'risk', 'approval'],
    })
    expect(getClientDocumentTemplate('research_report').contract).toMatchObject({
      purpose: 'research_presentation',
      approvalMode: 'operational',
      taskFanout: 'none',
      aiPromptKey: 'client_documents.research_report',
      recommendedBlockTypes: [
        'summary',
        'problem',
        'rich_text',
        'table',
        'deliverables',
        'metrics',
        'risk',
        'callout',
        'approval',
      ],
    })
    expect(getClientDocumentTemplate('change_request').contract).toMatchObject({
      purpose: 'scope_change_approval',
      approvalMode: 'operational',
      taskFanout: 'approval_gated',
      aiPromptKey: 'client_documents.change_request',
      recommendedBlockTypes: ['hero', 'summary', 'scope', 'timeline', 'investment', 'approval'],
    })
  })

  it('resolves template metadata safely for legacy documents with old or missing template IDs', () => {
    const legacyByTemplateId = getClientDocumentTemplate({ templateId: 'research-report-v1' })
    const legacyByType = getClientDocumentTemplate({ type: 'change_request', templateId: 'change_request' })
    const fallback = getClientDocumentTemplate({ templateId: 'deleted-template-v0' })

    expect(legacyByTemplateId.type).toBe('research_report')
    expect(legacyByType.type).toBe('change_request')
    expect(fallback).toMatchObject({
      id: 'legacy-safe-fallback',
      type: 'build_spec',
      approvalMode: 'operational',
      requiredBlockTypes: ['hero', 'summary', 'approval'],
    })
  })

  it('deep-clones object content from template defaults', () => {
    const template = getClientDocumentTemplate('build_spec')
    const templateBlock = template.defaultBlocks[0]
    const originalContent = templateBlock.content
    const objectContent = { sections: [{ label: 'Scope', items: ['Homepage'] }] }

    try {
      templateBlock.content = objectContent

      const [generatedBlock] = createBlocksFromTemplate('build_spec')

      expect(generatedBlock.content).toEqual(objectContent)
      expect(generatedBlock.content).not.toBe(objectContent)
      expect((generatedBlock.content as typeof objectContent).sections).not.toBe(objectContent.sections)
      expect((generatedBlock.content as typeof objectContent).sections[0]).not.toBe(objectContent.sections[0])
    } finally {
      templateBlock.content = originalContent
    }
  })
})
