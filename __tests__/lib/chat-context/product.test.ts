import { productChatActions } from '@/lib/chat-context/adapters/product'

describe('product chat actions', () => {
  it('keeps ordinary members read-only', () => {
    expect(productChatActions({
      id: 'product-1',
      orgId: 'org-1',
      active: true,
      actorRole: 'member',
    })).toEqual([])
  })

  it('lets catalog managers deactivate an active product with explicit confirmation', () => {
    expect(productChatActions({
      id: 'product-1',
      orgId: 'org-1',
      active: true,
      actorRole: 'admin',
    })).toEqual([{
      id: 'deactivate-product:product-1',
      label: 'Deactivate product',
      href: '/api/v1/crm/products/product-1?orgId=org-1',
      method: 'PUT',
      destructive: true,
      requiresApproval: true,
      body: { active: false },
    }])
  })

  it('offers a non-destructive reactivation for inactive products', () => {
    expect(productChatActions({
      id: 'product-1',
      orgId: 'org-1',
      active: false,
      actorRole: 'owner',
    })).toEqual([{
      id: 'activate-product:product-1',
      label: 'Activate product',
      href: '/api/v1/crm/products/product-1?orgId=org-1',
      method: 'PUT',
      requiresApproval: true,
      body: { active: true },
    }])
  })
})
