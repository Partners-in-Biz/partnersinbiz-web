import { fireEvent, render, screen } from '@testing-library/react'
import PortalSegmentsPage, { extractSegmentsList } from '@/app/(portal)/portal/segments/page'

const fetchMock = jest.fn()

beforeAll(() => {
  Object.defineProperty(global, 'fetch', {
    configurable: true,
    value: fetchMock,
  })
})

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/v1/crm/segments') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              segments: [
                {
                  id: 'seg-vip',
                  name: 'VIP decision makers',
                  description: 'High-value stakeholders ready for account work',
                  filters: { tags: ['vip'], stage: 'proposal' },
                },
              ],
            },
          }),
      })
    }
    if (url === '/api/v1/crm/segments/seg-vip/resolve') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { count: 7 } }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) })
  })
})

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

  it('treats an empty searched segment lens as a reversible saved-audience view', async () => {
    render(<PortalSegmentsPage />)

    expect(await screen.findByText('VIP decision makers')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search segments'), { target: { value: 'no-match' } })

    expect(await screen.findByRole('heading', { name: 'No saved audiences match this view.' })).toBeInTheDocument()
    expect(screen.getByText('Clear the segment search and focus filters to return to every saved audience.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show all segments' }))

    expect(screen.getByText('VIP decision makers')).toBeInTheDocument()
    expect(screen.getByLabelText('Search segments')).toHaveValue('')
  })
})
