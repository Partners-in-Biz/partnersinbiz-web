// lib/auth/totp.ts
// RFC 6238 TOTP implementation using Node's crypto. No external deps.
// HMAC-SHA1, 30s window, 6 digits, base32 secret.
import crypto from 'crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const DEFAULT_DIGITS = 6
const DEFAULT_PERIOD = 30

/** Encode a Buffer as RFC 4648 base32 (no padding). */
function base32Encode(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

/** Decode an RFC 4648 base32 string (padding/whitespace tolerant) to a Buffer. */
function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** Generate a new base32-encoded TOTP secret (default 20 random bytes / 160 bits). */
export function generateSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes))
}

/**
 * Build an otpauth:// URI for QR provisioning.
 * label = the account label (usually email), issuer = service name.
 */
export function otpauthUrl(secret: string, label: string, issuer: string): string {
  const encodedIssuer = encodeURIComponent(issuer)
  const encodedLabel = encodeURIComponent(label)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DEFAULT_DIGITS),
    period: String(DEFAULT_PERIOD),
  })
  return `otpauth://totp/${encodedIssuer}:${encodedLabel}?${params.toString()}`
}

/** Compute the HOTP/TOTP code for a given counter value. */
function hotp(secretBuffer: Buffer, counter: number, digits = DEFAULT_DIGITS): string {
  const counterBuffer = Buffer.alloc(8)
  // Write 64-bit big-endian counter.
  let tmp = counter
  for (let i = 7; i >= 0; i--) {
    counterBuffer[i] = tmp & 0xff
    tmp = Math.floor(tmp / 256)
  }
  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  const otp = binary % 10 ** digits
  return otp.toString().padStart(digits, '0')
}

/**
 * Verify a TOTP token against a secret.
 * `window` allows N steps of clock drift on either side (default 1 => ±30s).
 */
export function verifyToken(
  secret: string,
  token: string,
  window = 1,
  period = DEFAULT_PERIOD,
): boolean {
  if (!secret || !token) return false
  const normalized = token.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(normalized)) return false
  const secretBuffer = base32Decode(secret)
  if (secretBuffer.length === 0) return false
  const counter = Math.floor(Date.now() / 1000 / period)
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const candidate = hotp(secretBuffer, counter + errorWindow)
    // Constant-time comparison.
    if (
      candidate.length === normalized.length &&
      crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(normalized))
    ) {
      return true
    }
  }
  return false
}

/** Generate N human-friendly backup codes (e.g. "a1b2-c3d4"). */
export function generateBackupCodes(n = 10): string[] {
  const codes: string[] = []
  for (let i = 0; i < n; i++) {
    const raw = crypto.randomBytes(5).toString('hex') // 10 hex chars
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 10)}`)
  }
  return codes
}

/** SHA-256 hash of a backup code for at-rest storage. */
export function hashBackupCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim().toLowerCase()).digest('hex')
}
