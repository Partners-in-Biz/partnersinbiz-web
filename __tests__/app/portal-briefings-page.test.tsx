import { render, screen } from '@testing-library/react'

const mockBriefingControlDesk = jest.fn(
  ({
    mode,
    portalScope,
  }: {
    mode: string
    portalScope?: {
      orgId?: string
      orgSlug?: string
      sourceCompanyId?: string
      sourceCompanyName?: string
    }
  }) => (
    <div
      data-testid="briefing-control-desk"
      data-mode={mode}
      data-org-id={portalScope?.orgId ?? ''}
      data-org-slug={portalScope?.orgSlug ?? ''}
      data-source-company-id={portalScope?.sourceCompanyId ?? ''}
      data-source-company-name={portalScope?.sourceCompanyName ?? ''}
    />
  ),
)

jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({
    get: () => undefined,
  })),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifySessionCookie: jest.fn(async () => {
      throw new Error('no session in test')
    }),
  },
  adminDb: {},
  adminApp: {},
}))

jest.mock('@/components/briefing/BriefingControlDesk', () => ({
  BriefingControlDesk: (props: {
    mode: string
    portalScope?: {
      orgId?: string
      orgSlug?: string
      sourceCompanyId?: string
      sourceCompanyName?: string
    }
  }) => mockBriefingControlDesk(props),
}))

describe('portal briefings page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('passes CRM company route scope into the briefing control desk', async () => {
    const Page = (await import('@/app/(portal)/portal/briefings/page')).default

    const result = await Page({
      searchParams: Promise.resolve({
        orgId: 'org-1',
        orgSlug: 'client-one',
        sourceCompanyId: 'company-1',
        sourceCompanyName: 'Lumen',
      }),
    } as never)

    render(result)

    expect(screen.getByTestId('briefing-control-desk')).toHaveAttribute('data-mode', 'portal')
    expect(screen.getByTestId('briefing-control-desk')).toHaveAttribute('data-org-id', 'org-1')
    expect(screen.getByTestId('briefing-control-desk')).toHaveAttribute('data-org-slug', 'client-one')
    expect(screen.getByTestId('briefing-control-desk')).toHaveAttribute('data-source-company-id', 'company-1')
    expect(screen.getByTestId('briefing-control-desk')).toHaveAttribute('data-source-company-name', 'Lumen')
  })
})
