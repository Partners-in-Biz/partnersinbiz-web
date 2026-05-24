import { render, screen } from '@testing-library/react'
import { AdminTopbarNav } from '@/components/admin/AdminTopbarNav'

jest.mock('next/navigation', () => ({
  usePathname: () => '/admin/dashboard',
}))

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt, ...props }: { alt: string }) => <img alt={alt} {...props} />,
}))

jest.mock('@/lib/contexts/OrgContext', () => ({
  useOrg: () => ({
    selectedOrgId: null,
    orgs: [],
  }),
}))

jest.mock('@/components/admin/OrgSwitcher', () => ({
  OrgSwitcher: () => <div data-testid="org-switcher" />,
}))

describe('AdminTopbarNav account display', () => {
  it('keeps the account email hidden until desktop-wide screens', () => {
    render(
      <AdminTopbarNav
        userEmail="peet@example.com"
        onToggleLayout={jest.fn()}
      />,
    )

    const email = screen.getByText('peet@example.com')

    expect(email).toHaveClass('hidden')
    expect(email).toHaveClass('xl:inline')
    expect(email).not.toHaveClass('lg:inline')
    expect(screen.getByRole('link', { name: /logout/i })).toBeInTheDocument()
  })
})
