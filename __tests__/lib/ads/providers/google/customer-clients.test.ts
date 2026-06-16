// __tests__/lib/ads/providers/google/customer-clients.test.ts
import { createCustomerClient } from '@/lib/ads/providers/google/customer-clients'

describe('createCustomerClient', () => {
  const realFetch = global.fetch

  afterEach(() => {
    global.fetch = realFetch
  })

  it('posts to the manager createCustomerClient endpoint and extracts the new customer id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    global.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return {
        ok: true,
        json: async () => ({
          resourceName: 'customers/1112223333/customerClients/9998887777',
        }),
      } as Response
    }) as typeof fetch

    const result = await createCustomerClient({
      managerCustomerId: '1112223333',
      accessToken: 'tok',
      developerToken: 'dev',
      descriptiveName: 'AHS Law',
      currencyCode: 'ZAR',
      timeZone: 'Africa/Johannesburg',
    })

    expect(result.customerId).toBe('9998887777')
    expect(result.resourceName).toBe('customers/1112223333/customerClients/9998887777')

    const { url, init } = calls[0]
    expect(url).toMatch(/customers\/1112223333:createCustomerClient$/)
    expect((init.headers as Record<string, string>)['login-customer-id']).toBe('1112223333')
    const sent = JSON.parse(init.body as string)
    expect(sent.customerClient).toEqual({
      descriptiveName: 'AHS Law',
      currencyCode: 'ZAR',
      timeZone: 'Africa/Johannesburg',
    })
  })

  it('throws with the HTTP status + body on failure', async () => {
    global.fetch = (async () =>
      ({ ok: false, status: 403, text: async () => 'PERMISSION_DENIED' }) as Response) as typeof fetch

    await expect(
      createCustomerClient({
        managerCustomerId: '1112223333',
        accessToken: 'tok',
        developerToken: 'dev',
        descriptiveName: 'AHS Law',
        currencyCode: 'ZAR',
        timeZone: 'Africa/Johannesburg',
      }),
    ).rejects.toThrow(/HTTP 403 — PERMISSION_DENIED/)
  })
})
