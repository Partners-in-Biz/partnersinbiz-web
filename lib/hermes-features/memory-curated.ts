import type { CuratedMemoryDoc } from './types'

const MAX_MEMORY_CHARS = 12_000
const MAX_USER_CHARS = 8_000

export function emptyMemory(orgId: string, agentId: string): CuratedMemoryDoc {
  return {
    orgId,
    agentId,
    memoryMd: '# MEMORY\n\n',
    userMd: '# USER\n\n',
    updatedAt: new Date().toISOString(),
  }
}

export function updateMemorySection(
  doc: CuratedMemoryDoc,
  section: 'memory' | 'user',
  content: string,
  updatedBy?: string,
): CuratedMemoryDoc {
  const text = content ?? ''
  if (section === 'memory' && text.length > MAX_MEMORY_CHARS) {
    throw new Error(`MEMORY.md exceeds ${MAX_MEMORY_CHARS} characters`)
  }
  if (section === 'user' && text.length > MAX_USER_CHARS) {
    throw new Error(`USER.md exceeds ${MAX_USER_CHARS} characters`)
  }
  return {
    ...doc,
    ...(section === 'memory' ? { memoryMd: text } : { userMd: text }),
    updatedAt: new Date().toISOString(),
    ...(updatedBy ? { updatedBy } : {}),
  }
}

export function appendMemoryBullet(
  doc: CuratedMemoryDoc,
  section: 'memory' | 'user',
  bullet: string,
  updatedBy?: string,
): CuratedMemoryDoc {
  const line = bullet.trim().replace(/^\s*-\s*/, '')
  if (!line) throw new Error('Memory bullet is required')
  const current = section === 'memory' ? doc.memoryMd : doc.userMd
  const next = `${current.trimEnd()}\n- ${line}\n`
  return updateMemorySection(doc, section, next, updatedBy)
}

export function memoryDispatchBlock(doc: CuratedMemoryDoc): string {
  return [
    '[Hermes curated memory]',
    '## MEMORY.md',
    doc.memoryMd.trim() || '(empty)',
    '',
    '## USER.md',
    doc.userMd.trim() || '(empty)',
    '',
  ].join('\n')
}
