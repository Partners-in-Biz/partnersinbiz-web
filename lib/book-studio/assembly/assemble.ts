// Assembly orchestrator for Book Studio: loads a project + its live chapters
// and pages, runs the interior/cover/epub engines per the format's assembly
// list, uploads the resulting artifacts, and writes the packageManifest back
// onto the project doc (+ a decision-log entry).

import crypto from 'crypto'
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

// Module-level injectable default so tests can stub image fetching without
// hitting the network. Real usage relies on global fetch (Node 18+ runtime).
let fetchImageImpl: (url: string) => Promise<Buffer> = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`failed to fetch image: ${url} (${res.status})`)
  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export function setFetchImageForAssembly(fn: typeof fetchImageImpl): void {
  fetchImageImpl = fn
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

  const prevVersion = Number((project.packageManifest as { version?: unknown } | undefined)?.version) || 0
  const manifest: PackageManifest = {
    status: 'generated',
    version: prevVersion + 1,
    qaStatus: 'pending_review',
    generatedAt: new Date().toISOString(),
    checksum: interiorChecksum ?? files[0]?.checksum ?? '',
    files,
  }

  await projectRef.update({
    packageManifest: manifest,
    ...updateActorFields(actor),
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
