import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import LinksPage from '@/app/(portal)/portal/social/links/page'

const link = {
  id: 'link-1',
  shortCode: 'launch42',
  shortUrl: 'https://pib.link/launch42',
  originalUrl: 'https://example.com/launch-page',
  utmSource: 'linkedin',
  utmMedium: 'social',
  utmCampaign: 'launch',
  clickCount: 18,
  createdAt: { seconds: 1780500000 },
  createdBy: 'user-1',
}

describe('Portal social links page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/links?page=1&limit=20') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: [link],
            meta: { total: 1 },
          }),
        } as Response)
      }
      if (url === '/api/v1/links/link-1' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('uses an in-page confirmation before deleting tracked campaign links', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    render(<LinksPage />)

    expect(await screen.findByText('launch42')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete tracked link launch42' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Delete tracked link "launch42"?' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'This removes the short link from future campaign use. Historical click analytics stay available in reports and audits.',
      ),
    ).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/links/link-1', expect.any(Object))

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete tracked link launch42' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/links/link-1', { method: 'DELETE' })
    })
    await waitFor(() => {
      expect(screen.queryByText('launch42')).not.toBeInTheDocument()
    })

    confirmSpy.mockRestore()
  })
})
