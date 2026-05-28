import { render, screen } from '@testing-library/react'
import { CompanyMigrationCommandCenter, type CompanyMigrationMatch } from '@/components/crm/CompanyMigrationCommandCenter'

const matches: CompanyMigrationMatch[] = [
  {
    normalizedKey: 'acme',
    contactIds: ['c1', 'c2'],
    suggestedCompanyName: 'Acme Ltd',
    existingCompanyId: null,
  },
  {
    normalizedKey: 'zenith',
    contactIds: ['c3'],
    suggestedCompanyName: 'Zenith Group',
    existingCompanyId: 'company-1',
  },
  {
    normalizedKey: 'blank-name',
    contactIds: ['c4', 'c5', 'c6'],
    suggestedCompanyName: '',
    existingCompanyId: null,
  },
]

describe('CompanyMigrationCommandCenter', () => {
  it('summarizes selected migration work before applying changes', () => {
    render(
      <CompanyMigrationCommandCenter
        matches={matches}
        selected={{ acme: true, zenith: true, 'blank-name': false }}
        names={{ acme: 'Acme Ltd', zenith: 'Zenith Group', 'blank-name': '' }}
      />,
    )

    expect(screen.getByText('Migration command center')).toBeInTheDocument()
    expect(screen.getByText('2/3')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1 new')).toBeInTheDocument()
    expect(screen.getByText(/1 existing account/i)).toBeInTheDocument()
    expect(screen.getByText(/selected contact records/i)).toBeInTheDocument()
  })

  it('flags selected groups that still need a reviewed company name', () => {
    render(
      <CompanyMigrationCommandCenter
        matches={matches}
        selected={{ acme: false, zenith: false, 'blank-name': true }}
        names={{ acme: 'Acme Ltd', zenith: 'Zenith Group', 'blank-name': '' }}
      />,
    )

    expect(screen.getByText('Review 1 name')).toBeInTheDocument()
  })
})
