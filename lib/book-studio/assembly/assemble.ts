// Assembly orchestrator for Book Studio: loads a project + its live chapters
// and pages, runs the interior/cover/epub engines per the format's assembly
// list, uploads the resulting artifacts, and writes the packageManifest back
// onto the project doc (+ a decision-log entry).

import crypto from 'crypto'
import { lookup } from 'dns/promises'
import net from 'net'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { actorFields, updateActorFields } from '../api'
import { getBookFormat, type BookFormat } from '../format-registry'
import { resolveTrimSpec, type TrimSpec } from '../trim'
import { buildInteriorPdf, AssemblyMissingAssetError, type InteriorChapterInput, type InteriorPageInput } from './interior-pdf'
import { buildCoverPdf } from './cover-pdf'
import { buildEpub } from './epub'
import { uploadBookFileToStorage } from '../storage'

export class AssemblyNotFoundError extends Error {
  constructor(message = 'book project not found') {
    super(message)
    this.name = 'AssemblyNotFoundError'
  }
}

export class AssemblyValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssemblyValidationError'
  }
}

export class AssemblyNotReadyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssemblyNotReadyError'
  }
}

export class AssemblyImageFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssemblyImageFetchError'
  }
}

export interface AssembleBookProjectInput {
  projectId: string
  orgId: string
  actor: ApiUser
}

export interface PackageManifestFile {
  role: 'interior_pdf' | 'cover_pdf' | 'epub'
  label: string
  href: string
  storagePath: string
  checksum: string
  bytes: number
  pageCount?: number
}

export interface PackageManifest {
  status: 'generated'
  version: number
  qaStatus: 'pending_review'
  generatedAt: string
  checksum: string
  files: PackageManifestFile[]
}

const MAX_IMAGE_FETCH_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_FETCH_REDIRECTS = 3
const IMAGE_FETCH_TIMEOUT_MS = 15_000

function parseIpv4(value: string): number[] | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map((part) => Number(part))
  return nums.every((num) => Number.isInteger(num) && num >= 0 && num <= 255) ? nums : null
}

function isPrivateIpv4(value: string): boolean {
  const ip = parseIpv4(value)
  if (!ip) return true
  const [a, b] = ip
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51) return true
  if (a === 203 && b === 0) return true
  if (a >= 224) return true
  return false
}

function firstIpv6Hextet(value: string): number | null {
  const first = value.toLowerCase().split(':').find(Boolean)
  if (!first) return null
  const parsed = Number.parseInt(first, 16)
  return Number.isFinite(parsed) ? parsed : null
}

function isPrivateIpv6(value: string): boolean {
  const ip = value.toLowerCase()
  if (ip.includes('%')) return true
  if (ip === '::' || ip === '::1') return true
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice('::ffff:'.length)
    return isPrivateIpv4(mapped)
  }
  const first = firstIpv6Hextet(ip)
  if (first === null) return true
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10
  if ((first & 0xff00) === 0xff00) return true // multicast
  if (first === 0x2001 && ip.startsWith('2001:db8')) return true
  return false
}

function isPrivateAddress(address: string): boolean {
  const version = net.isIP(address)
  if (version === 4) return isPrivateIpv4(address)
  if (version === 6) return isPrivateIpv6(address)
  return true
}

async function assertPublicFetchTarget(url: URL): Promise<void> {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new AssemblyImageFetchError('image URL must use http or https')
  }
  if (url.username || url.password) {
    throw new AssemblyImageFetchError('image URL credentials are not allowed')
  }
  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '')
  const hostAddressVersion = net.isIP(hostname)
  if (hostAddressVersion) {
    if (isPrivateAddress(hostname)) {
      throw new AssemblyImageFetchError('image URL resolves to a private or reserved address')
    }
    return
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new AssemblyImageFetchError('image URL resolves to a private or reserved address')
  }
}

async function readCappedResponseBody(response: Response): Promise<Buffer> {
  const lengthHeader = response.headers.get('content-length')
  if (lengthHeader) {
    const length = Number(lengthHeader)
    if (Number.isFinite(length) && length > MAX_IMAGE_FETCH_BYTES) {
      throw new AssemblyImageFetchError('image exceeds the 10MB fetch limit')
    }
  }
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > MAX_IMAGE_FETCH_BYTES) {
      throw new AssemblyImageFetchError('image exceeds the 10MB fetch limit')
    }
    return buffer
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > MAX_IMAGE_FETCH_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new AssemblyImageFetchError('image exceeds the 10MB fetch limit')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export async function fetchImageForAssemblyFromUrl(url: string, redirectCount = 0): Promise<Buffer> {
  if (redirectCount > MAX_IMAGE_FETCH_REDIRECTS) {
    throw new AssemblyImageFetchError('too many image redirects')
  }
  const target = new URL(url)
  await assertPublicFetchTarget(target)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(target, { redirect: 'manual', signal: controller.signal })
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location')
      if (!location) throw new AssemblyImageFetchError('image redirect missing location')
      const redirected = new URL(location, target)
      return fetchImageForAssemblyFromUrl(redirected.toString(), redirectCount + 1)
    }
    if (!res.ok) throw new Error(`failed to fetch image: ${target.toString()} (${res.status})`)
    return readCappedResponseBody(res)
  } finally {
    clearTimeout(timeout)
  }
}

// Module-level injectable default so tests can stub image fetching without
// hitting the network. Real usage relies on the SSRF-hardened fetcher above.
let fetchImageImpl: (url: string) => Promise<Buffer> = fetchImageForAssemblyFromUrl

export function setFetchImageForAssembly(fn: typeof fetchImageImpl): void {
  fetchImageImpl = fn
}

export function resetFetchImageForAssembly(): void {
  fetchImageImpl = fetchImageForAssemblyFromUrl
}

function sha256Hex(buffer: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
}

const FILE_LABELS: Record<PackageManifestFile['role'], string> = {
  interior_pdf: 'Interior PDF',
  cover_pdf: 'Cover PDF',
  epub: 'EPUB',
}

const IMAGE_PAGE_KINDS = new Set(['illustration', 'colouring', 'comic', 'activity'])

export async function assembleBookProject(input: AssembleBookProjectInput): Promise<PackageManifest> {
  const { projectId, orgId, actor } = input

  const projectRef = adminDb.collection('book_studio_projects').doc(projectId)
  const projectSnap = await projectRef.get()
  const project = projectSnap.exists ? projectSnap.data() ?? {} : null
  if (!project || project.orgId !== orgId || project.deleted === true) {
    throw new AssemblyNotFoundError()
  }

  const formatId = typeof project.format === 'string' ? project.format : ''
  const format: BookFormat | null = formatId ? getBookFormat(formatId) : null
  if (!format) throw new AssemblyValidationError('unknown book format')

  const trimPresetId = (project.trim as { presetId?: string } | undefined)?.presetId ?? format.defaultTrim
  const trim: TrimSpec | null = resolveTrimSpec(trimPresetId)
  if (!trim) throw new AssemblyValidationError('unknown trim preset')

  const reflowable = format.layout === 'reflowable'

  // --- load live chapters + pages, org-scoped, order asc ---
  const [chaptersSnap, pagesSnap] = await Promise.all([
    adminDb.collection('book_studio_chapters').where('orgId', '==', orgId).where('projectId', '==', projectId).get(),
    adminDb.collection('book_studio_pages').where('orgId', '==', orgId).where('projectId', '==', projectId).get(),
  ])

  const chapters = chaptersSnap.docs
    .map((doc) => doc.data())
    .filter((data) => data.deleted !== true)
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .map((data): InteriorChapterInput => ({
      title: typeof data.title === 'string' ? data.title : '',
      body: typeof data.body === 'string' ? data.body : '',
      order: Number(data.order) || 0,
    }))

  const pages = pagesSnap.docs
    .map((doc) => doc.data())
    .filter((data) => data.deleted !== true)
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .map((data): InteriorPageInput => ({
      order: Number(data.order) || 0,
      kind: data.kind,
      imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : undefined,
      caption: typeof data.caption === 'string' ? data.caption : undefined,
      puzzle: data.puzzle && typeof data.puzzle === 'object' ? data.puzzle : undefined,
    }))

  // --- readiness checks ---
  if (reflowable) {
    const hasContent = chapters.some((chapter) => chapter.body.trim().length > 0)
    if (!hasContent) throw new AssemblyNotReadyError('no chapters')
  } else {
    if (pages.length === 0) throw new AssemblyNotReadyError('no pages')
    // Fixed layout: every content page of an image kind needs an imageUrl.
    // Reuse the check inside buildInteriorPdf (called below) rather than
    // duplicating it here — it throws AssemblyMissingAssetError listing the
    // missing page orders, which the route maps to 422.
    const missing = pages.filter((p) => IMAGE_PAGE_KINDS.has(p.kind) && !p.imageUrl).map((p) => p.order)
    if (missing.length > 0) throw new AssemblyMissingAssetError(missing)
  }

  const projectForEngines = {
    id: projectId,
    projectId,
    title: typeof project.title === 'string' ? project.title : 'Untitled',
    metadata: (project.metadata as Record<string, unknown> | undefined) ?? {},
    coverImageUrl: typeof project.coverImageUrl === 'string' ? project.coverImageUrl : undefined,
  }

  const files: PackageManifestFile[] = []
  let interiorPageCount = 0
  let interiorChecksum: string | undefined

  // 1. Interior PDF (always first — cover needs its page count).
  if (format.assembly.includes('pdf_interior')) {
    const { pdfBytes, pageCount } = await buildInteriorPdf({
      project: projectForEngines,
      format,
      trim,
      chapters: reflowable ? chapters : undefined,
      pages: reflowable ? undefined : pages,
      fetchImage: fetchImageImpl,
    })
    interiorPageCount = pageCount
    const buffer = toBuffer(pdfBytes)
    const checksum = sha256Hex(buffer)
    interiorChecksum = checksum
    const { publicUrl, storagePath } = await uploadBookFileToStorage(
      buffer,
      'application/pdf',
      orgId,
      projectId,
      'interior.pdf',
    )
    files.push({
      role: 'interior_pdf',
      label: FILE_LABELS.interior_pdf,
      href: publicUrl,
      storagePath,
      checksum,
      bytes: buffer.byteLength,
      pageCount,
    })
  }

  // 2. Cover PDF.
  if (format.assembly.includes('pdf_cover')) {
    const coverImage = projectForEngines.coverImageUrl
      ? await fetchImageImpl(projectForEngines.coverImageUrl)
      : undefined
    const { pdfBytes } = await buildCoverPdf({
      project: projectForEngines,
      trim,
      interiorPageCount,
      coverImage,
      fetchImage: fetchImageImpl,
    })
    const buffer = toBuffer(pdfBytes)
    const checksum = sha256Hex(buffer)
    const { publicUrl, storagePath } = await uploadBookFileToStorage(
      buffer,
      'application/pdf',
      orgId,
      projectId,
      'cover.pdf',
    )
    files.push({
      role: 'cover_pdf',
      label: FILE_LABELS.cover_pdf,
      href: publicUrl,
      storagePath,
      checksum,
      bytes: buffer.byteLength,
    })
  }

  // 3. EPUB (reflowable only).
  if (format.assembly.includes('epub')) {
    const coverImage = projectForEngines.coverImageUrl
      ? await fetchImageImpl(projectForEngines.coverImageUrl)
      : undefined
    const epubBytes = await buildEpub({
      project: projectForEngines,
      chapters,
      coverImage,
    })
    const buffer = toBuffer(epubBytes)
    const checksum = sha256Hex(buffer)
    const { publicUrl, storagePath } = await uploadBookFileToStorage(
      buffer,
      'application/epub+zip',
      orgId,
      projectId,
      'book.epub',
    )
    files.push({
      role: 'epub',
      label: FILE_LABELS.epub,
      href: publicUrl,
      storagePath,
      checksum,
      bytes: buffer.byteLength,
    })
  }

  const manifest = await adminDb.runTransaction(async (tx) => {
    const latestSnap = await tx.get(projectRef)
    const latest = latestSnap.exists ? latestSnap.data() ?? {} : null
    if (!latest || latest.orgId !== orgId || latest.deleted === true) {
      throw new AssemblyNotFoundError()
    }
    const prevVersion = Number((latest.packageManifest as { version?: unknown } | undefined)?.version) || 0
    const nextManifest: PackageManifest = {
      status: 'generated',
      version: prevVersion + 1,
      qaStatus: 'pending_review',
      generatedAt: new Date().toISOString(),
      checksum: interiorChecksum ?? files[0]?.checksum ?? '',
      files,
    }
    tx.update(projectRef, {
      packageManifest: nextManifest,
      ...updateActorFields(actor),
    })
    return nextManifest
  })

  const summary = `Assembled package v${manifest.version}: ${files.map((f) => f.label).join(', ')}`
  await adminDb.collection('book_studio_decision_logs').add({
    orgId,
    projectId,
    decision: 'package_assembled',
    safeSummary: summary,
    ...actorFields(actor),
  })

  return manifest
}
