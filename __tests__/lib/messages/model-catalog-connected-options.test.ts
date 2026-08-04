import { connectedModelOptions } from '@/lib/messages/model-catalog'

describe('connectedModelOptions', () => {
  it('emits curated DeepSeek models as selectable when binding is ready', () => {
    const models = connectedModelOptions([
      {
        connectionId: 'user:u1:deepseek',
        connectionLabel: 'Deepseek Mac',
        credentialBindingId: 'bind-ready',
        provider: 'deepseek',
        modelIds: null,
        available: true,
      },
    ], '')
    const ids = models.map((m) => m.id)
    expect(ids[0]).toBe('deepseek-v4-flash')
    expect(ids).toEqual(expect.arrayContaining([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-chat',
      'deepseek-reasoner',
    ]))
    expect(models.every((m) => m.available && m.connected && m.credentialBindingId === 'bind-ready')).toBe(true)
  })

  it('still lists DeepSeek curated rows when sync is pending (not selectable)', () => {
    const models = connectedModelOptions([
      {
        connectionId: 'user:u1:deepseek',
        connectionLabel: 'Deepseek Mac',
        credentialBindingId: 'bind-delivering',
        provider: 'deepseek',
        modelIds: ['deepseek-v4-flash'],
        available: false,
        reasonUnavailable: 'Deepseek Mac is connected, but credentials are still syncing to this machine/agent (delivering). Wait for idle, Sync in Settings, then Refresh Models.',
      },
    ], '')
    expect(models.some((m) => m.id === 'deepseek-v4-flash')).toBe(true)
    expect(models.every((m) => m.available === false)).toBe(true)
    expect(models.every((m) => m.connected === false)).toBe(true)
    expect(models[0]?.reasonUnavailable).toMatch(/still syncing|delivering/i)
    expect(models[0]?.connectionId).toBe('user:u1:deepseek')
  })

  it('tolerates missing modelIds without throwing', () => {
    expect(() => connectedModelOptions([
      {
        connectionId: 'user:u1:openai-codex',
        connectionLabel: 'Codex Mac',
        credentialBindingId: 'bind',
        provider: 'openai-codex',
        modelIds: undefined,
        available: true,
      },
    ], '')).not.toThrow()
  })
})
