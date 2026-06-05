import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import NewCompanyPage from '@/app/(portal)/portal/companies/new/page'

const mockPush = jest.fn()
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('@/components/crm/CompanyEditDrawer', () => ({
  CompanyEditDrawer: ({ onSave, onClose }: { onSave: (data: { name: string }) => Promise<void>; onClose: () => void }) => (
    <section aria-label="Mock company drawer">
      <button type="button" onClick={() => onSave({ name: 'Scoped Company' })}>
        Save scoped company
      </button>
      <button type="button" onClick={onClose}>
        Close company drawer
      </button>
    </section>
  ),
}))

describe('Portal new company page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/team') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ members: [] }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { id: 'company-new' } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  it('keeps company creation, team loading, close, and post-save routing inside the selected workspace', async () => {
    const scope = 'orgId=org-1&orgSlug=lumen-speeds&sourceCompanyId=source-company&sourceCompanyName=Lumen'
    mockSearchParams = new URLSearchParams(scope)
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/team?orgId=org-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ members: [] }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies?orgId=org-1' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { id: 'company-new' } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<NewCompanyPage />)

    expect(screen.getByRole('link', { name: 'arrow_back Companies' })).toHaveAttribute('href', `/portal/companies?${scope}`)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/settings/team?orgId=org-1')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save scoped company' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/companies?orgId=org-1', expect.objectContaining({ method: 'POST' }))
    })
    expect(mockPush).toHaveBeenCalledWith(`/portal/companies/company-new?${scope}`)

    fireEvent.click(screen.getByRole('button', { name: 'Close company drawer' }))
    expect(mockPush).toHaveBeenCalledWith(`/portal/companies?${scope}`)
  })
})
