import '@testing-library/jest-dom'
import { render, screen, waitFor, within } from '@testing-library/react'
import OrganizationsPage from '@/app/(admin)/admin/organizations/page'
import NewOrganizationPage from '@/app/(admin)/admin/organizations/new/page'
import PlatformUsersPage from '@/app/(admin)/admin/platform-users/page'
import PlatformMembersPage from '@/app/(admin)/admin/platform-members/page'

const push = jest.fn()
const fetchMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

jest.mock('@/lib/firebase/auth', () => ({
  resetPassword: jest.fn(),
}))

jest.mock('@/lib/utils/clipboard', () => ({
  copyToClipboard: jest.fn(),
}))

beforeEach(() => {
  push.mockReset()
  fetchMock.mockReset()
  global.fetch = fetchMock
})

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function mockPlatformFetches() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/v1/organizations') {
      return jsonResponse({
        data: [
          { id: 'pib-platform-owner', name: 'Partners in Biz', slug: 'partners-in-biz', type: 'platform_owner', status: 'active', memberCount: 4 },
          { id: 'org-1', name: 'Acme Client', slug: 'acme', type: 'client', status: 'active', memberCount: 2 },
          { id: 'org-2', name: 'Book Studio', slug: 'book-studio', type: 'client', status: 'onboarding', memberCount: 0 },
        ],
      })
    }
    if (url === '/api/v1/admin/platform-users') {
      return jsonResponse({
        data: [
          { uid: 'super-1', email: 'peet@partnersinbiz.online', displayName: 'Peet Stander', role: 'admin', allowedOrgIds: [], isSuperAdmin: true },
          { uid: 'staff-1', email: 'ops@partnersinbiz.online', displayName: 'Ops Admin', role: 'admin', allowedOrgIds: ['org-1'], isSuperAdmin: false },
        ],
      })
    }
    if (url === '/api/v1/admin/platform-members') {
      return jsonResponse({
        data: [
          {
            uid: 'client-1',
            email: 'jane@acme.test',
            displayName: 'Jane Client',
            role: 'client',
            orgIds: ['org-1'],
            linkedOrgs: [{ id: 'org-1', name: 'Acme Client', slug: 'acme', role: 'admin', source: 'membership' }],
            authFound: true,
          },
        ],
      })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

it('frames the organisations list as a platform-admin client workspace surface, not member management', async () => {
  mockPlatformFetches()

  render(<OrganizationsPage />)

  expect(await screen.findByRole('heading', { name: 'Client Workspaces' })).toBeInTheDocument()
  expect(screen.getByText('Platform-admin operations for client organisations, workspace provisioning, and operational status.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '+ Provision client workspace' })).toHaveAttribute('href', '/admin/organizations/new')
  expect(screen.queryByText('Members')).not.toBeInTheDocument()
  expect(screen.getByText('Portal access')).toBeInTheDocument()
  expect(screen.queryByText('Partners in Biz')).not.toBeInTheDocument()
})

it('makes new organisation creation explicit as a platform provisioning operation', () => {
  render(<NewOrganizationPage />)

  expect(screen.getByRole('heading', { name: 'Provision Client Workspace' })).toBeInTheDocument()
  expect(screen.getByText('Platform-admin operation: creates a client organisation record and optional Cowork/Hermes workspace scaffolding.')).toBeInTheDocument()
  expect(screen.getByText('Client Workspace Details')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Provision client workspace' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'New Client' })).not.toBeInTheDocument()
})

it('explains super-admin and restricted-admin allowedOrgIds behavior on platform users', async () => {
  mockPlatformFetches()

  render(<PlatformUsersPage />)

  expect(await screen.findByRole('heading', { name: 'Platform Admin Users' })).toBeInTheDocument()
  expect(screen.getByText('Staff accounts for PiB operators. Super admins have global platform access; restricted admins are limited by allowedOrgIds.')).toBeInTheDocument()

  const superRow = screen.getByText('Peet Stander').closest('li')
  expect(superRow).not.toBeNull()
  expect(within(superRow as HTMLElement).getByText('Super admin')).toBeInTheDocument()
  expect(within(superRow as HTMLElement).getByText('allowedOrgIds: [] means global access')).toBeInTheDocument()

  const restrictedRow = screen.getByText('Ops Admin').closest('li')
  expect(restrictedRow).not.toBeNull()
  expect(within(restrictedRow as HTMLElement).getByText('Restricted admin')).toBeInTheDocument()
  expect(within(restrictedRow as HTMLElement).getByText('allowedOrgIds: 1 client org')).toBeInTheDocument()
  expect(within(restrictedRow as HTMLElement).getByText('Acme Client')).toBeInTheDocument()
})

it('frames platform-members as client portal access administration with explicit admin controls', async () => {
  mockPlatformFetches()

  render(<PlatformMembersPage />)

  expect(await screen.findByRole('heading', { name: 'Client Portal Access' })).toBeInTheDocument()
  expect(screen.getByText('Platform-admin controls for client portal logins, account links, role changes, resets, and access removal.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '+ Add portal login' })).toBeInTheDocument()
  expect(screen.getByText('Portal logins')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '+ Add member' })).not.toBeInTheDocument()
})
