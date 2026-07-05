import { encryptConnectionCredentials, decryptConnectionCredentials } from '@/lib/creative-canvas/connections/crypto'

describe('connection credential crypto', () => {
  beforeAll(() => { process.env.SOCIAL_TOKEN_MASTER_KEY = 'test-master-key-for-canvas-connections' })

  it('round-trips org-scoped credentials', () => {
    const blob = encryptConnectionCredentials({ apiKey: 'xai-abc123' }, 'org-1')
    expect(decryptConnectionCredentials(blob, 'org-1')).toEqual({ apiKey: 'xai-abc123' })
  })

  it('round-trips user-scoped credentials with the user scope key', () => {
    const blob = encryptConnectionCredentials({ apiKey: 'r8_zzz', apiSecret: 's' }, 'user:uid-9')
    expect(decryptConnectionCredentials(blob, 'user:uid-9')).toEqual({ apiKey: 'r8_zzz', apiSecret: 's' })
  })

  it('cannot decrypt across scopes (org key never reads user blob and vice versa)', () => {
    const blob = encryptConnectionCredentials({ apiKey: 'secret' }, 'user:uid-9')
    expect(() => decryptConnectionCredentials(blob, 'org-1')).toThrow()
  })
})
