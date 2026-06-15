import { Readable } from 'node:stream'
import type { drive_v3, sheets_v4 } from 'googleapis'
import { buildGoogleWorkspaceClients, type GoogleWorkspaceClients } from '@/lib/google-workspace/client'
import { cleanString } from '@/lib/workspace-os/common'

const DRIVE_FILE_FIELDS = 'id,name,mimeType,webViewLink,parents,size,modifiedTime'
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'
const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation'
const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder'
const GOOGLE_NATIVE_MIME_TYPES = new Set([GOOGLE_DOC_MIME, GOOGLE_SHEET_MIME, GOOGLE_SLIDES_MIME])

export type GoogleDriveFile = {
  id: string
  name: string | null
  mimeType: string | null
  webViewLink: string | null
  parents: string[]
  size: string | null
  modifiedTime: string | null
}

export type DriveFileListResult = {
  files: GoogleDriveFile[]
  nextPageToken?: string
}

export type DriveDownloadResult = {
  fileId: string
  name: string
  mimeType: string
  content: Buffer
}

function normalizeDriveFile(file: drive_v3.Schema$File): GoogleDriveFile {
  const id = cleanString(file.id)
  if (!id) throw new Error('Google Drive returned a file without an id')
  return {
    id,
    name: cleanString(file.name),
    mimeType: cleanString(file.mimeType),
    webViewLink: cleanString(file.webViewLink),
    parents: Array.isArray(file.parents) ? file.parents.filter((item): item is string => typeof item === 'string' && item.length > 0) : [],
    size: cleanString(file.size),
    modifiedTime: cleanString(file.modifiedTime),
  }
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function pageSize(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50
  return Math.min(Math.max(Math.trunc(value as number), 1), 200)
}

function folderClause(folderId: string): string {
  return `'${escapeDriveQueryValue(folderId)}' in parents`
}

function baseDriveListQuery(folderId?: string): string {
  const clauses = ['trashed = false']
  if (folderId) clauses.push(folderClause(folderId))
  return clauses.join(' and ')
}

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (typeof data === 'string') return Buffer.from(data)
  throw new Error('Google Drive returned unsupported download data')
}

function defaultExportMimeType(mimeType: string | null | undefined): string {
  if (mimeType === GOOGLE_SHEET_MIME) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (mimeType === GOOGLE_SLIDES_MIME) return 'application/pdf'
  return 'application/pdf'
}

function exportedName(name: string, mimeType: string): string {
  if (mimeType === 'application/pdf' && !name.toLowerCase().endsWith('.pdf')) return `${name}.pdf`
  if (mimeType.includes('spreadsheetml') && !name.toLowerCase().endsWith('.xlsx')) return `${name}.xlsx`
  return name
}

export async function listDriveFiles(input: {
  folderId: string
  pageSize?: number
  pageToken?: string | null
  includeFolders?: boolean
}): Promise<DriveFileListResult> {
  const clients = await buildGoogleWorkspaceClients()
  const query = input.includeFolders
    ? baseDriveListQuery(input.folderId)
    : `${baseDriveListQuery(input.folderId)} and mimeType != '${GOOGLE_FOLDER_MIME}'`
  const result = await clients.drive.files.list({
    q: query,
    pageSize: pageSize(input.pageSize),
    pageToken: cleanString(input.pageToken) ?? undefined,
    fields: `nextPageToken, files(${DRIVE_FILE_FIELDS})`,
    orderBy: 'folder,name',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })
  return {
    files: (result.data.files ?? []).map(normalizeDriveFile),
    nextPageToken: cleanString(result.data.nextPageToken) ?? undefined,
  }
}

export async function searchDriveFiles(input: {
  query: string
  folderId?: string | null
  pageSize?: number
  pageToken?: string | null
}): Promise<DriveFileListResult> {
  const clients = await buildGoogleWorkspaceClients()
  const query = cleanString(input.query)
  if (!query) throw new Error('query is required')
  const escaped = escapeDriveQueryValue(query)
  const clauses = [
    baseDriveListQuery(cleanString(input.folderId) ?? undefined),
    `(name contains '${escaped}' or fullText contains '${escaped}')`,
  ]
  const result = await clients.drive.files.list({
    q: clauses.join(' and '),
    pageSize: pageSize(input.pageSize),
    pageToken: cleanString(input.pageToken) ?? undefined,
    fields: `nextPageToken, files(${DRIVE_FILE_FIELDS})`,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })
  return {
    files: (result.data.files ?? []).map(normalizeDriveFile),
    nextPageToken: cleanString(result.data.nextPageToken) ?? undefined,
  }
}

export async function uploadDriveFile(input: {
  folderId: string
  name: string
  mimeType: string
  content: Buffer
}): Promise<GoogleDriveFile> {
  const folderId = cleanString(input.folderId)
  if (!folderId) throw new Error('folderId is required')
  const name = cleanString(input.name)
  if (!name) throw new Error('name is required')
  const mimeType = cleanString(input.mimeType) ?? 'application/octet-stream'
  const clients = await buildGoogleWorkspaceClients()
  const created = await clients.drive.files.create({
    requestBody: { name, mimeType, parents: [folderId] },
    media: { mimeType, body: Readable.from(input.content) },
    fields: DRIVE_FILE_FIELDS,
    supportsAllDrives: true,
  })
  return normalizeDriveFile(created.data)
}

export async function downloadDriveFile(input: {
  fileId: string
  exportMimeType?: string | null
}): Promise<DriveDownloadResult> {
  const fileId = cleanString(input.fileId)
  if (!fileId) throw new Error('fileId is required')
  const clients = await buildGoogleWorkspaceClients()
  const metadata = await clients.drive.files.get({
    fileId,
    fields: 'id,name,mimeType',
    supportsAllDrives: true,
  })
  const name = cleanString(metadata.data.name) ?? fileId
  const mimeType = cleanString(metadata.data.mimeType)
  const exportMimeType = cleanString(input.exportMimeType) ?? (GOOGLE_NATIVE_MIME_TYPES.has(mimeType ?? '') ? defaultExportMimeType(mimeType) : null)

  if (exportMimeType) {
    const exported = await clients.drive.files.export(
      { fileId, mimeType: exportMimeType },
      { responseType: 'arraybuffer' },
    )
    return { fileId, name: exportedName(name, exportMimeType), mimeType: exportMimeType, content: toBuffer(exported.data) }
  }

  const downloaded = await clients.drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  )
  return { fileId, name, mimeType: mimeType ?? 'application/octet-stream', content: toBuffer(downloaded.data) }
}

export async function shareDriveFile(input: {
  fileId: string
  emailAddress?: string | null
  type?: string | null
  role?: string | null
  sendNotificationEmail?: boolean
}): Promise<drive_v3.Schema$Permission> {
  const fileId = cleanString(input.fileId)
  if (!fileId) throw new Error('fileId is required')
  const type = cleanString(input.type) ?? 'user'
  if (type !== 'user' && type !== 'group') throw new Error('Only user and group Drive shares are allowed through this endpoint')
  const emailAddress = cleanString(input.emailAddress)
  if (!emailAddress) throw new Error('emailAddress is required')
  const role = cleanString(input.role) ?? 'reader'
  if (!['reader', 'writer', 'commenter'].includes(role)) throw new Error('Invalid role; expected reader, writer, or commenter')
  const clients = await buildGoogleWorkspaceClients()
  const permission = await clients.drive.permissions.create({
    fileId,
    requestBody: { type, role, emailAddress },
    sendNotificationEmail: input.sendNotificationEmail ?? false,
    fields: 'id,type,role,emailAddress,domain',
    supportsAllDrives: true,
  })
  return permission.data
}

async function moveFileToFolder(fileId: string, folderId: string | null | undefined, drive: GoogleWorkspaceClients['drive']) {
  const targetFolderId = cleanString(folderId)
  if (!targetFolderId) return
  const current = await drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true })
  const previousParents = (current.data.parents ?? []).join(',')
  await drive.files.update({
    fileId,
    addParents: targetFolderId,
    removeParents: previousParents || undefined,
    fields: 'id,parents',
    supportsAllDrives: true,
  })
}

export async function createGoogleDoc(input: {
  title: string
  folderId?: string | null
  content?: string | null
}): Promise<{ documentId: string; title: string; webViewLink: string }> {
  const title = cleanString(input.title)
  if (!title) throw new Error('title is required')
  const clients = await buildGoogleWorkspaceClients()
  const created = await clients.docs.documents.create({ requestBody: { title } })
  const documentId = cleanString(created.data.documentId)
  if (!documentId) throw new Error('Google Docs did not return a document id')
  await moveFileToFolder(documentId, input.folderId, clients.drive)
  const content = cleanString(input.content)
  if (content) {
    await clients.docs.documents.batchUpdate({
      documentId,
      requestBody: { requests: [{ insertText: { location: { index: 1 }, text: content } }] },
    })
  }
  return {
    documentId,
    title: cleanString(created.data.title) ?? title,
    webViewLink: `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`,
  }
}

export async function appendSheetValues(input: {
  spreadsheetId: string
  range: string
  values: unknown[][]
  valueInputOption?: string | null
  insertDataOption?: string | null
}): Promise<sheets_v4.Schema$AppendValuesResponse> {
  const spreadsheetId = cleanString(input.spreadsheetId)
  if (!spreadsheetId) throw new Error('spreadsheetId is required')
  const range = cleanString(input.range)
  if (!range) throw new Error('range is required')
  if (!Array.isArray(input.values)) throw new Error('values must be a two-dimensional array')
  const clients = await buildGoogleWorkspaceClients()
  const result = await clients.sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: cleanString(input.valueInputOption) ?? 'USER_ENTERED',
    insertDataOption: cleanString(input.insertDataOption) ?? 'INSERT_ROWS',
    requestBody: { values: input.values },
  })
  return result.data
}

export async function readSheetValues(input: {
  spreadsheetId: string
  range: string
  majorDimension?: string | null
}): Promise<sheets_v4.Schema$ValueRange> {
  const spreadsheetId = cleanString(input.spreadsheetId)
  if (!spreadsheetId) throw new Error('spreadsheetId is required')
  const range = cleanString(input.range)
  if (!range) throw new Error('range is required')
  const clients = await buildGoogleWorkspaceClients()
  const result = await clients.sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    majorDimension: cleanString(input.majorDimension) ?? undefined,
  })
  return result.data
}
