import crypto from 'node:crypto'

export interface EncryptedLinkedSecret { ciphertext: string; iv: string; tag: string }

function masterKey(): Buffer {
  const value = process.env.SOCIAL_TOKEN_MASTER_KEY?.trim()
  if (!value) throw new Error('Missing env var: SOCIAL_TOKEN_MASTER_KEY')
  return value.length === 64 && /^[0-9a-f]+$/i.test(value)
    ? Buffer.from(value, 'hex')
    : crypto.createHash('sha256').update(value).digest()
}

function scopedKey(context: string): Buffer {
  return crypto.createHmac('sha256', masterKey()).update(`linked-computer-secret:${context}`).digest()
}

function legacyRotationKey(context: string): Buffer {
  return crypto.createHmac('sha256', masterKey()).update(`linked-computer-runtime-transport:${context}`).digest()
}

export function encryptLinkedSecret(value: string, context: string): EncryptedLinkedSecret {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', scopedKey(context), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}

export function decryptLinkedSecret(value: EncryptedLinkedSecret, context: string): string {
  const decrypt = (key: Buffer) => {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
    return decipher.update(Buffer.from(value.ciphertext, 'base64')) + decipher.final('utf8')
  }
  try { return decrypt(scopedKey(context)) } catch { return decrypt(legacyRotationKey(context)) }
}
