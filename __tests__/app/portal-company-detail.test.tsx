import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import CompanyDetailPage from '@/app/(portal)/portal/companies/[id]/page'

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'company-1' }),
}))

describe('Portal company detail page', () => {
  beforeEach(() => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock
  })

  it('unwraps the company detail API envelope before rendering the header', async () => {
    render(<CompanyDetailPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Acme Holdings' })).toBeInTheDocument()
    })
  })
})
