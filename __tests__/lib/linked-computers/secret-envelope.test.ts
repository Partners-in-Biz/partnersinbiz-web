import crypto from 'node:crypto'
import { decryptLinkedSecret, encryptLinkedSecret } from '@/lib/linked-computers/secret-envelope'

describe('linked computer secret envelope', () => {
  beforeEach(() => { process.env.SOCIAL_TOKEN_MASTER_KEY = 'secret-envelope-test-key' })

  it('round trips new values and reads pending rotation values from the legacy cryptographic context', () => {
    const context = 'device-a:rotation-credential'
    const encrypted = encryptLinkedSecret('new-credential', context)
    expect(decryptLinkedSecret(encrypted, context)).toBe('new-credential')

    const master = crypto.createHash('sha256').update('secret-envelope-test-key').digest()
    const key = crypto.createHmac('sha256', master).update(`linked-computer-runtime-transport:${context}`).digest()
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update('pending-credential', 'utf8'), cipher.final()])
    expect(decryptLinkedSecret({ ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') }, context))
      .toBe('pending-credential')
  })
})
