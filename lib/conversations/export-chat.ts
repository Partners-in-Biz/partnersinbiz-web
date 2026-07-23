/**
 * Client-side chat export helpers — Markdown transcript + file download.
 */

export type ExportableChatMessage = {
  id?: string
  role?: string
  content?: string
  authorKind?: 'user' | 'agent' | 'system' | string
  authorDisplayName?: string
  authorId?: string
  status?: string
  error?: string
  model?: string
  provider?: string
  attachments?: Array<{ name?: string; url?: string }>
  createdAt?: { seconds?: number; _seconds?: number } | string | number | Date | null
}

export type ExportChatInput = {
  title?: string | null
  conversationId?: string
  exportedAt?: Date
  messages: ExportableChatMessage[]
}

function messageTimestampMs(createdAt: ExportableChatMessage['createdAt']): number {
  if (!createdAt) return 0
  if (createdAt instanceof Date) return createdAt.getTime()
  if (typeof createdAt === 'number') return createdAt < 1e12 ? createdAt * 1000 : createdAt
  if (typeof createdAt === 'string') {
    const parsed = Date.parse(createdAt)
    return Number.isFinite(parsed) ? parsed : 0
  }
  const seconds = createdAt.seconds ?? createdAt._seconds
  return typeof seconds === 'number' ? seconds * 1000 : 0
}

function formatTimestamp(createdAt: ExportableChatMessage['createdAt']): string {
  const ms = messageTimestampMs(createdAt)
  if (!ms) return ''
  try {
    return new Date(ms).toISOString()
  } catch {
    return ''
  }
}

function speakerLabel(message: ExportableChatMessage): string {
  const name = message.authorDisplayName?.trim()
  if (name) return name
  if (message.authorKind === 'agent') return message.authorId || 'Agent'
  if (message.authorKind === 'system') return 'System'
  if (message.role === 'assistant') return 'Assistant'
  if (message.role === 'system') return 'System'
  return 'You'
}

function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/[^\w\s.-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

export function buildChatExportFilename(title?: string | null, exportedAt = new Date()): string {
  const stamp = exportedAt.toISOString().slice(0, 10)
  const base = sanitizeFilenamePart(title || 'conversation') || 'conversation'
  return `${base}-${stamp}.md`
}

export function formatChatExportMarkdown(input: ExportChatInput): string {
  const exportedAt = input.exportedAt ?? new Date()
  const title = (input.title || 'Conversation').trim() || 'Conversation'
  const sorted = input.messages
    .slice()
    .sort((a, b) => messageTimestampMs(a.createdAt) - messageTimestampMs(b.createdAt))

  const lines: string[] = [
    `# ${title}`,
    '',
    `- Exported: ${exportedAt.toISOString()}`,
  ]
  if (input.conversationId) {
    lines.push(`- Conversation ID: \`${input.conversationId}\``)
  }
  lines.push(`- Messages: ${sorted.length}`, '')

  if (sorted.length === 0) {
    lines.push('_No messages in this conversation._', '')
    return lines.join('\n')
  }

  for (const message of sorted) {
    const when = formatTimestamp(message.createdAt)
    const speaker = speakerLabel(message)
    const metaBits = [
      when || null,
      message.status && message.status !== 'complete' && message.status !== 'completed'
        ? `status: ${message.status}`
        : null,
      message.model ? `model: ${message.model}` : null,
      message.provider ? `provider: ${message.provider}` : null,
    ].filter(Boolean)

    lines.push(`## ${speaker}`)
    if (metaBits.length > 0) {
      lines.push(`_${metaBits.join(' · ')}_`, '')
    } else {
      lines.push('')
    }

    const content = (message.content || '').trim()
    if (content) {
      lines.push(content, '')
    } else if (message.error) {
      lines.push(`_Error: ${message.error}_`, '')
    } else {
      lines.push('_No text content._', '')
    }

    if (message.attachments && message.attachments.length > 0) {
      lines.push('**Attachments**')
      for (const attachment of message.attachments) {
        const name = attachment.name?.trim() || 'attachment'
        if (attachment.url) {
          lines.push(`- [${name}](${attachment.url})`)
        } else {
          lines.push(`- ${name}`)
        }
      }
      lines.push('')
    }
  }

  return lines.join('\n').trimEnd() + '\n'
}

export function downloadTextFile(filename: string, content: string, mimeType = 'text/markdown;charset=utf-8'): void {
  if (typeof document === 'undefined') {
    throw new Error('downloadTextFile requires a browser document')
  }
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function exportChatAsMarkdown(input: ExportChatInput): { filename: string; markdown: string } {
  const exportedAt = input.exportedAt ?? new Date()
  const markdown = formatChatExportMarkdown({ ...input, exportedAt })
  const filename = buildChatExportFilename(input.title, exportedAt)
  downloadTextFile(filename, markdown)
  return { filename, markdown }
}
