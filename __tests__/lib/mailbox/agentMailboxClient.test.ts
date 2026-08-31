import { callAgentMailbox } from '@/lib/mailbox/agentMailboxClient'

describe('agent mailbox HTTP client — silent remint + retry', () => {
  const orgId = 'org-1'
  const staleToken = 'pib_dlg_stale'
  const freshToken = 'pib_dlg_fresh'
  const mailboxUrl = 'https://partnersinbiz.online/api/v1/agent/email/messages?orgId=org-1&uid=staff-1'

  it('remints once and retries when mailbox returns 403 with delegation-evidence', async () => {
    const remint = jest.fn(async () => ({ token: freshToken }))
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ success: false, error: 'Mailbox delegation evidence is required for requested user context' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ success: true, data: { messages: [{ id: 'msg-1' }] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))

    const res = await callAgentMailbox({
      url: mailboxUrl,
      auth: { token: staleToken, orgId, remint },
      fetchImpl,
    })

    expect(res.status).toBe(200)
    expect(remint).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${staleToken}`)
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${freshToken}`)
    const body = await res.json()
    expect(body.data.messages[0].id).toBe('msg-1')
  })

  it('remints once and retries when mailbox returns 401 for an expired dlg token', async () => {
    const remint = jest.fn(async () => ({ token: freshToken }))
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ success: true, data: { accounts: [] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))

    const res = await callAgentMailbox({
      url: 'https://partnersinbiz.online/api/v1/agent/email/accounts?orgId=org-1',
      auth: { token: staleToken, orgId, remint },
      fetchImpl,
    })

    expect(res.status).toBe(200)
    expect(remint).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not fall back to AI_API_KEY when the reminted retry also fails', async () => {
    process.env.AI_API_KEY = 'legacy-god-key'
    const remint = jest.fn(async () => ({ token: freshToken }))
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ success: false, error: 'Mailbox delegation evidence is required for requested user context' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ success: false, error: 'Mailbox delegation evidence is required for requested user context' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ))

    const res = await callAgentMailbox({
      url: mailboxUrl,
      auth: { token: staleToken, orgId, remint },
      fetchImpl,
    })

    expect(res.status).toBe(403)
    expect(remint).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    for (const call of fetchImpl.mock.calls) {
      expect(call[1].headers.Authorization).not.toBe('Bearer legacy-god-key')
      expect(String(call[1].headers.Authorization)).toMatch(/^Bearer pib_dlg_/)
    }
  })

  it('does not remint or fall back to AI_API_KEY when the caller is not a dlg token', async () => {
    process.env.AI_API_KEY = 'legacy-god-key'
    const remint = jest.fn(async () => ({ token: 'pib_dlg_should_not_use' }))
    const fetchImpl = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: false, error: 'Mailbox delegation evidence is required for requested user context' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    ))

    const res = await callAgentMailbox({
      url: mailboxUrl,
      auth: { token: 'pib_ag_system_key', orgId, remint },
      fetchImpl,
    })

    expect(res.status).toBe(403)
    expect(remint).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer pib_ag_system_key')
  })

  it('rejects a remint that tries to return AI_API_KEY and keeps the original mailbox failure', async () => {
    process.env.AI_API_KEY = 'legacy-god-key'
    const remint = jest.fn(async () => ({ token: 'legacy-god-key' }))
    const fetchImpl = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: false, error: 'Mailbox delegation evidence is required for requested user context' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    ))

    const res = await callAgentMailbox({
      url: mailboxUrl,
      auth: { token: staleToken, orgId, remint },
      fetchImpl,
    })

    expect(res.status).toBe(403)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${staleToken}`)
  })
})
