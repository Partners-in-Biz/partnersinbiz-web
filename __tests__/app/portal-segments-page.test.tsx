import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('names segment creation commands without decorative icon text', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/segments') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { segments: [] } }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) })
    })

    render(<PortalSegmentsPage />)

    expect(await screen.findByRole('heading', { name: 'No segments yet.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New segment' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create first segment' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add New segment/i })).not.toBeInTheDocument()
  })

  it('warns when segments fail to load and gives leaders a retry path', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/segments') {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: 'Segments index unavailable' }),
        })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PortalSegmentsPage />)

    expect(await screen.findByRole('heading', { name: 'Segments could not load' })).toBeInTheDocument()
    expect(screen.getByText('Segments index unavailable')).toBeInTheDocument()
    expect(screen.queryByText('No segments yet.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading segments' }))

    await waitFor(() => {
      const segmentRequests = fetchMock.mock.calls.filter(([url]) => String(url) === '/api/v1/crm/segments')
      expect(segmentRequests).toHaveLength(2)
    })
  })

  it('uses an in-page confirmation before deleting a saved audience segment', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    render(<PortalSegmentsPage />)

    expect(await screen.findByText('VIP decision makers')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete segment VIP decision makers' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(await screen.findByRole('alertdialog', { name: 'Delete segment "VIP decision makers"?' })).toBeInTheDocument()
    expect(screen.getByText('This removes the saved audience lens for 7 contacts. Existing contact records and campaign history stay available for audit.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/crm/segments/seg-vip', { method: 'DELETE' })
    expect(screen.getByRole('button', { name: 'Cancel delete for segment VIP decision makers' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete segment VIP decision makers' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/crm/segments/seg-vip', { method: 'DELETE' })
    })
    await waitFor(() => {
      expect(screen.queryByText('VIP decision makers')).not.toBeInTheDocument()
    })

    confirmSpy.mockRestore()
  })

  it('names sparse segment rows and delete confirmations instead of exposing blank controls', async () => {
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
                    id: 'seg-sparse',
                    name: '',
                    description: '',
                    filters: {},
                  },
                ],
              },
            }),
        })
      }
      if (url === '/api/v1/crm/segments/seg-sparse/resolve') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { count: 0 } }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) })
    })

    render(<PortalSegmentsPage />)

    expect(await screen.findByText('Segment name missing')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete segment Segment name missing' }))

    expect(await screen.findByRole('alertdialog', { name: 'Delete segment "Segment name missing"?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel delete for segment Segment name missing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm delete segment Segment name missing' })).toBeInTheDocument()
  })
})
