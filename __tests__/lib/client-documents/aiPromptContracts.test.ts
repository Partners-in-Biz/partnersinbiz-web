import {
  buildClientDocumentAiPrompt,
  getClientDocumentAiPromptContract,
} from '@/lib/client-documents/aiPromptContracts'

describe('client document AI prompt contracts', () => {
  it('selects a research-native contract for polished research reports', () => {
    const contract = getClientDocumentAiPromptContract('research_report')

    expect(contract.key).toBe('client_documents.research_report')
    expect(contract.requiredSections).toEqual([
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
    ])
    expect(contract.requiredSections).not.toContain('technicalApproach')
    expect(contract.requiredSections).not.toContain('rollback')
  })

  it.each(['build_spec', 'change_request'] as const)(
    'selects an engineering contract for %s with implementation planning sections',
    (type) => {
      const contract = getClientDocumentAiPromptContract(type)

      expect(contract.requiredSections).toEqual(expect.arrayContaining([
        'requirements',
        'technicalApproach',
        'apiDataChanges',
        'tests',
        'rollback',
        'taskBreakdown',
      ]))
      expect(contract.requiredSections).not.toContain('contradictionsUnknowns')
      expect(contract.requiredSections).not.toContain('decisionNeeded')
    },
  )

  it('renders different prompt instructions for research reports and engineering specs', () => {
    const researchPrompt = buildClientDocumentAiPrompt({
      documentType: 'research_report',
      title: 'Competitor research',
      sourceMaterial: 'Compare competitors and cite sources.',
    })
    const buildSpecPrompt = buildClientDocumentAiPrompt({
      documentType: 'build_spec',
      title: 'Portal build',
      sourceMaterial: 'Implement the approved portal change.',
    })
    const changeRequestPrompt = buildClientDocumentAiPrompt({
      documentType: 'change_request',
      title: 'Scope change',
      sourceMaterial: 'Assess impact of a new API requirement.',
    })

    expect(researchPrompt).toContain('Research question')
    expect(researchPrompt).toContain('Source ledger')
    expect(researchPrompt).toContain('Evidence appendix')
    expect(researchPrompt).toContain('Decision needed')
    expect(researchPrompt).not.toContain('Rollback plan')

    expect(buildSpecPrompt).toContain('Technical approach')
    expect(buildSpecPrompt).toContain('API/data changes')
    expect(buildSpecPrompt).toContain('Tests')
    expect(buildSpecPrompt).toContain('Rollback plan')
    expect(buildSpecPrompt).toContain('Task breakdown')
    expect(buildSpecPrompt).not.toContain('Contradictions')

    expect(changeRequestPrompt).toContain('Technical approach')
    expect(changeRequestPrompt).toContain('Task breakdown')
    expect(changeRequestPrompt).not.toContain('Contradictions')
    expect(researchPrompt).not.toBe(buildSpecPrompt)
    expect(buildSpecPrompt).not.toBe(changeRequestPrompt)
  })
})
