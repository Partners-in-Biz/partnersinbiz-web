/**
 * RFC 2047 encoded-words for raw MIME headers.
 *
 * RFC 5322 headers must be ASCII. Non-ASCII (em dashes, smart quotes, etc.)
 * must be encoded as `=?UTF-8?B?<base64>?=` so Gmail/SMTP do not mojibake
 * the Subject line while the UTF-8 body still renders correctly.
 */

const PRINTABLE_ASCII = /^[\x20-\x7E]*$/

export function encodeMimeHeaderValue(value: string): string {
  const sanitized = value.replace(/[\r\n]+/g, ' ').trim()
  if (PRINTABLE_ASCII.test(sanitized)) return sanitized
  return `=?UTF-8?B?${Buffer.from(sanitized, 'utf8').toString('base64')}?=`
}
