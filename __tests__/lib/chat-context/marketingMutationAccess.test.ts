import type { ApiUser } from '@/lib/api/types'

const mockPolicyCheck = jest.fn()
jest.mock('@/lib/organizations/module-policy-access', () => ({
  assertUserCanPerformOrganizationModuleAction: (...args: unknown[]) => mockPolicyCheck(...args),
}))

const client = (overrides: Partial<ApiUser> = {}): ApiUser => ({
  uid: 'client-1', role: 'client', orgId: 'org-1', memberAccessPolicy: { preset: 'full', modules: { marketing: true }, recordScopes: {} } as never, ...overrides,
})

describe('Marketing Studio mutation authorization', () => {
  beforeEach(() => mockPolicyCheck.mockReset().mockResolvedValue({ ok: true }))

  it('rejects a foreign organisation before consulting role policy', async () => {
    const { authorizeMarketingStudioMutation } = await import('@/lib/chat-context/marketingMutationAccess')
    await expect(authorizeMarketingStudioMutation(client(), 'org-2', 'create')).resolves.toMatchObject({ ok: false, status: 403 })
    expect(mockPolicyCheck).not.toHaveBeenCalled()
  })

  it('rejects a client whose member access policy denies Marketing', async () => {
    const { authorizeMarketingStudioMutation } = await import('@/lib/chat-context/marketingMutationAccess')
    await expect(authorizeMarketingStudioMutation(client({ memberAccessPolicy: { preset: 'custom', modules: { marketing: false }, recordScopes: {} } as never }), 'org-1', 'create')).resolves.toMatchObject({ ok: false, status: 403 })
    expect(mockPolicyCheck).not.toHaveBeenCalled()
  })

  it('returns the organisation role-policy denial', async () => {
    mockPolicyCheck.mockResolvedValueOnce({ ok: false, status: 403, error: 'Role denied' })
    const { authorizeMarketingStudioMutation } = await import('@/lib/chat-context/marketingMutationAccess')
    await expect(authorizeMarketingStudioMutation(client(), 'org-1', 'approvePublish')).resolves.toEqual({ ok: false, status: 403, error: 'Role denied' })
  })

  it('allows an entitled organisation member when the action policy allows it', async () => {
    const { authorizeMarketingStudioMutation } = await import('@/lib/chat-context/marketingMutationAccess')
    await expect(authorizeMarketingStudioMutation(client(), 'org-1', 'create')).resolves.toEqual({ ok: true })
    expect(mockPolicyCheck).toHaveBeenCalledWith(expect.objectContaining({ uid: 'client-1' }), 'org-1', 'marketing', 'create', expect.any(String))
  })
})
