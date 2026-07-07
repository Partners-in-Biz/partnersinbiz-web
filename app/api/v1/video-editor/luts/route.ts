import crypto from 'crypto'
import { getStorage } from 'firebase-admin/storage'
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { actorFields, ensureOrgAccess } from '@/lib/youtube-studio/api'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { serializeVideoEditorRecord } from '@/lib/video-editor/sanitize'
import type { VideoEditorLut } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

const MAX_LUT_BYTES = 8 * 1024 * 1024
const NUMBER_TOKEN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

function cleanString(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 120) || 'grade.cube'
}

function isValidCube(text: string): boolean {
  let size = 0
  const rows: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const tokens = line.split(/\s+/)
    const [keyword, maybeSize] = tokens
    if (keyword === 'LUT_3D_SIZE') {
      if (tokens.length !== 2) return false
      const parsed = Number(maybeSize)
      if (!Number.isInteger(parsed) || parsed < 2 || parsed > 64) return false
      size = parsed
      continue
    }
    if (keyword === 'DOMAIN_MIN' || keyword === 'DOMAIN_MAX') {
      if (tokens.length !== 4 || !tokens.slice(1).every((token) => NUMBER_TOKEN.test(token))) return false
      continue
    }
    if (keyword === 'LUT_1D_SIZE') {
      if (tokens.length !== 2 || !Number.isInteger(Number(maybeSize)) || Number(maybeSize) < 2) return false
      continue
    }
    if (keyword === 'TITLE') {
      if (!/^TITLE\s+"[^"]+"$/i.test(line)) return false
      continue
    }
    if (tokens.length === 3 && tokens.every((token) => NUMBER_TOKEN.test(token))) {
      rows.push(line)
      continue
    }
    return false
  }
  return size > 0 && rows.length === size ** 3
}

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const snapshot = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.luts).where('orgId', '==', orgId).get()
  const luts = snapshot.docs
    .filter((doc) => doc.data().deleted !== true)
    .map((doc) => serializeVideoEditorRecord<VideoEditorLut>(doc.id, doc.data()))
    .sort((a, b) => a.title.localeCompare(b.title))

  return apiSuccess({ luts })
})

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const formData = await req.formData().catch(() => null)
  if (!formData) return apiError('Invalid form data', 400)
  const orgId = cleanString(formData.get('orgId'))
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const file = formData.get('file')
  if (!(file instanceof File)) return apiError('No file provided', 400)
  if (!/\.cube$/i.test(file.name)) return apiError('LUTs must be .cube files', 400)
  if (file.size > MAX_LUT_BYTES) return apiError('LUT file is too large (max 8MB)', 413)

  const buffer = Buffer.from(await file.arrayBuffer())
  if (!isValidCube(buffer.toString('utf8'))) {
    return apiError('File is not a valid .cube LUT', 400)
  }

  const title = cleanString(formData.get('title')) || file.name.replace(/\.cube$/i, '')
  const storagePath = `video-editor/${orgId}/luts/${Date.now()}-${crypto.randomUUID()}-${safeFilename(file.name)}`
  const bucket = getStorage(getAdminApp()).bucket()
  const downloadToken = crypto.randomUUID()
  await bucket.file(storagePath).save(buffer, {
    metadata: {
      contentType: 'text/plain',
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
  })
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`
  const record = {
    orgId,
    title,
    url,
    storagePath,
    sizeBytes: buffer.length,
    deleted: false,
    ...actorFields(user),
  }
  const ref = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.luts).add(record)

  return apiSuccess({ lut: { id: ref.id, title, url, storagePath, sizeBytes: buffer.length } }, 201)
})
