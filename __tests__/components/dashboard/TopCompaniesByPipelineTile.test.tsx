import { render, screen, waitFor } from '@testing-library/react'
import { TopCompaniesByPipelineTile } from '@/components/dashboard/TopCompaniesByPipelineTile'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

describe('TopCompaniesByPipelineTile', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/companies?orderBy=updatedAt-desc&limit=5&orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              companies: [
                {
                  id: 'company-1',
                  name: 'Lumen',
                },
              ],
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  it('keeps recent company fetches and links scoped to a CRM company workspace', async () => {
    render(
      <TopCompaniesByPipelineTile
        orgScope={{
          orgId: 'lumen-org',
          orgSlug: 'lumen-speeds',
          sourceCompanyId: 'source-company',
          sourceCompanyName: 'Lumen',
        }}
      />,
    )

    await screen.findByRole('link', { name: /Lumen/ })

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/companies?orderBy=updatedAt-desc&limit=5&orgId=lumen-org')
    expect(screen.getByRole('link', { name: /View all/ })).toHaveAttribute(
      'href',
      '/portal/companies?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=source-company&sourceCompanyName=Lumen',
    )
    expect(screen.getByRole('link', { name: /Lumen/ })).toHaveAttribute(
      'href',
      '/portal/companies/company-1?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=source-company&sourceCompanyName=Lumen',
    )
  })

  it('hides when the scoped workspace has no companies', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ data: { companies: [] } }),
      } as Response),
    ) as jest.Mock

    const { container } = render(<TopCompaniesByPipelineTile orgScope={{ orgId: 'empty-org' }} />)

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement()
    })
  })
})
