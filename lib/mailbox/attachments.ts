export type MailboxAttachmentInput = {
  name: string
  contentType?: string
  contentBase64: string
  sizeBytes?: number
}

export type MailboxAttachmentStored = {
  name: string
  contentType: string
  contentBase64: string
  sizeBytes: number
}

export type MailboxAttachmentSafe = Omit<MailboxAttachmentStored, 'contentBase64'>

const MAX_ATTACHMENTS = 5
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024

function cleanFilename(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

function cleanContentType(value: unknown): string {
  const contentType = String(value ?? '').replace(/[\r\n]+/g, '').trim().toLowerCase()
  return contentType && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(contentType) ? contentType : 'application/octet-stream'
}

function normalizeBase64(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.includes(',') ? value.split(',').pop() ?? '' : value
  const normalized = raw.replace(/\s+/g, '')
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null
  try {
    Buffer.from(normalized, 'base64')
    return normalized
  } catch {
    return null
  }
}

export function sanitizeMailboxAttachments(value: unknown): { attachments: MailboxAttachmentStored[]; error?: string } {
  if (value == null) return { attachments: [] }
  if (!Array.isArray(value)) return { attachments: [], error: 'Attachments must be an array' }
  if (value.length > MAX_ATTACHMENTS) return { attachments: [], error: `Attach no more than ${MAX_ATTACHMENTS} files` }

  const attachments: MailboxAttachmentStored[] = []
  let totalBytes = 0
  for (const item of value) {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const name = cleanFilename(record.name)
    if (!name) return { attachments: [], error: 'Each attachment needs a filename' }
    const contentBase64 = normalizeBase64(record.contentBase64)
    if (!contentBase64) return { attachments: [], error: `Attachment ${name} is not valid base64` }
    const sizeBytes = Buffer.from(contentBase64, 'base64').byteLength
    if (sizeBytes > MAX_ATTACHMENT_BYTES) return { attachments: [], error: `Attachment ${name} is larger than 5 MB` }
    totalBytes += sizeBytes
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) return { attachments: [], error: 'Attachments are larger than 10 MB in total' }
    attachments.push({
      name,
      contentType: cleanContentType(record.contentType),
      contentBase64,
      sizeBytes,
    })
  }
  return { attachments }
}

export function serializeMailboxAttachments(value: unknown): MailboxAttachmentSafe[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
      const name = cleanFilename(record.name)
      if (!name) return null
      return {
        name,
        contentType: cleanContentType(record.contentType),
        sizeBytes: Math.max(0, Number(record.sizeBytes ?? 0)),
      }
    })
    .filter((item): item is MailboxAttachmentSafe => Boolean(item))
}
