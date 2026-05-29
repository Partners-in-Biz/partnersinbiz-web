import { extractPipelinesList } from '@/lib/pipelines/response'

describe('extractPipelinesList', () => {
  it('reads the CRM pipelines API envelope', () => {
    const list = extractPipelinesList({
      success: true,
      data: {
        pipelines: [
          {
            id: 'pipe-1',
            name: 'Sales',
            orgId: 'org-1',
            stages: [],
          },
        ],
      },
    })

    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('pipe-1')
  })

  it('keeps older array-shaped data responses working', () => {
    const list = extractPipelinesList({
      success: true,
      data: [
        {
          id: 'pipe-2',
          name: 'Retention',
          orgId: 'org-1',
          stages: [],
        },
      ],
    })

    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('pipe-2')
  })

  it('keeps older top-level pipelines responses working', () => {
    const list = extractPipelinesList({
      pipelines: [
        {
          id: 'pipe-3',
          name: 'Legacy',
          orgId: 'org-1',
          stages: [],
        },
      ],
    })

    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('pipe-3')
  })
})
