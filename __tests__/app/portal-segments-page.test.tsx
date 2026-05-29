import { extractSegmentsList } from '@/app/(portal)/portal/segments/page'

describe('portal segments page response parsing', () => {
  it('reads the CRM segments API envelope', () => {
    const list = extractSegmentsList({
      success: true,
      data: {
        segments: [
          {
            id: 'seg-1',
            name: 'Hot leads',
            description: '',
            filters: {},
          },
        ],
      },
    })

    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('seg-1')
  })

  it('keeps older array-shaped responses working', () => {
    const list = extractSegmentsList({
      success: true,
      data: [
        {
          id: 'seg-2',
          name: 'VIP',
          description: '',
          filters: {},
        },
      ],
    })

    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('seg-2')
  })
})
