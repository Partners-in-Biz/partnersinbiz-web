const mockLoadCompany = jest.fn()
const mockCanReadCompany = jest.fn()

jest.mock('@/lib/companies/store', () => ({ loadCompany: mockLoadCompany }))
jest.mock('@/lib/crm/assignment-access', () => ({
  crmActorCanReadCompanyRecord: mockCanReadCompany,
}))

import { getConversationCompanyForUser } from '@/lib/companies/conversation-access'

beforeEach(() => {
  jest.clearAllMocks()
  mockLoadCompany.mockResolvedValue({
    data: { id: 'company-1', orgId: 'org-1', name: 'Acme', deleted: false },
  })
})

it('allows an administrator to select a company in the active CRM organisation', async () => {
  await expect(getConversationCompanyForUser('company-1', 'org-1', {
    uid: 'admin-1', role: 'admin', orgId: 'org-1',
  })).resolves.toEqual(expect.objectContaining({ id: 'company-1', name: 'Acme' }))
  expect(mockCanReadCompany).not.toHaveBeenCalled()
})

it('enforces the user company assignment boundary for a client', async () => {
  mockCanReadCompany.mockResolvedValue(false)
  await expect(getConversationCompanyForUser('company-1', 'org-1', {
    uid: 'user-1', role: 'client', orgId: 'org-1',
  })).resolves.toBeNull()
  expect(mockCanReadCompany).toHaveBeenCalledWith(
    expect.objectContaining({ orgId: 'org-1', uid: 'user-1', role: 'member' }),
    'company-1',
    expect.objectContaining({ orgId: 'org-1' }),
  )
})

it('never resolves a company from another organisation', async () => {
  mockLoadCompany.mockResolvedValue(null)
  await expect(getConversationCompanyForUser('company-1', 'org-1', {
    uid: 'admin-1', role: 'admin', orgId: 'org-1',
  })).resolves.toBeNull()
})
