import { FieldValue } from 'firebase-admin/firestore'
import { google } from 'googleapis'
import { adminDb } from '@/lib/firebase/admin'
import { WORKSPACE_ARTIFACT_COLLECTION, normalizeWorkspaceArtifactInput } from '@/lib/workspace-os/artifacts'
import { asRecord, cleanString } from '@/lib/workspace-os/common'
import { canExecuteWorkspaceBrokerJob, type WorkspaceBrokerJob, type WorkspaceBrokerOperation } from '@/lib/workspace-os/broker'
import { assertWorkspaceBrokerExecutionGate } from '@/lib/workspace-os/brokerGates'

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'
const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder'
const PDF_MIME = 'application/pdf'
const GOOGLE_MUTATION_OPERATIONS = new Set<WorkspaceBrokerOperation>(['create_folder', 'create_doc', 'create_sheet', 'copy_template_doc', 'copy_template_sheet', 'export_pdf', 'request_share', 'request_delete'])

export interface WorkspaceBrokerExecutionResult {
  googleMutationPerformed: boolean
  providerResultIds: string[]
  artifactIds: string[]
  artifactUrls: string[]
  output: Record<string, unknown>
}

type DriveClient = ReturnType<typeof google.drive>
type DocsClient = ReturnType<typeof google.docs>
type SheetsClient = ReturnType<typeof google.sheets>

interface GoogleWorkspaceClients {
  drive: DriveClient
  docs: DocsClient
  sheets: SheetsClient
}

function requiredEnvCredentialPath(): string {
  const credentialPath = cleanString(process.env.GOOGLE_WORKSPACE_CREDS_JSON_PATH)
  if (!credentialPath) throw new Error('GOOGLE_WORKSPACE_CREDS_JSON_PATH is not configured')
  return credentialPath
}

async function buildGoogleWorkspaceClients(): Promise<GoogleWorkspaceClients> {
  const keyFile = requiredEnvCredentialPath()
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  })
  return {
    drive: google.drive({ version: 'v3', auth }),
    docs: google.docs({ version: 'v1', auth }),
    sheets: google.sheets({ version: 'v4', auth }),
  }
}

function inputTitle(input: Record<string, unknown>, fallback: string): string {
  return cleanString(input.title) ?? cleanString(input.name) ?? fallback
}

function parentIds(input: Record<string, unknown>): string[] | undefined {
  const explicit = cleanString(input.parentFolderId) ?? cleanString(input.folderId) ?? cleanString(input.googleFolderId)
  if (explicit) return [explicit]
  const parents = input.parents
  if (Array.isArray(parents)) {
    const cleaned = parents.map((item) => cleanString(item)).filter((item): item is string => !!item)
    return cleaned.length ? cleaned : undefined
  }
  return undefined
}

function webViewLinkFor(fileId: string, mimeType: string): string {
  if (mimeType === GOOGLE_FOLDER_MIME) return `https://drive.google.com/drive/folders/${encodeURIComponent(fileId)}`
  if (mimeType === GOOGLE_DOC_MIME) return `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/edit`
  if (mimeType === GOOGLE_SHEET_MIME) return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}/edit`
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`
}

async function moveFileToParents(drive: DriveClient, fileId: string, parents: string[] | undefined) {
  if (!parents?.length) return
  const current = await drive.files.get({ fileId, fields: 'parents' })
  const previousParents = (current.data.parents ?? []).join(',')
  await drive.files.update({ fileId, addParents: parents.join(','), removeParents: previousParents || undefined, fields: 'id, parents' })
}

async function createGoogleResource(operation: WorkspaceBrokerOperation, input: Record<string, unknown>, clients: GoogleWorkspaceClients): Promise<{ fileId: string; title: string; mimeType: string; url: string; parents: string[]; size?: string | null }> {
  const parents = parentIds(input) ?? []
  const title = inputTitle(input, operation)

  if (operation === 'create_folder') {
    const created = await clients.drive.files.create({
      requestBody: { name: title, mimeType: GOOGLE_FOLDER_MIME, parents: parents.length ? parents : undefined },
      fields: 'id, name, mimeType, webViewLink, parents',
    })
    const fileId = cleanString(created.data.id)
    if (!fileId) throw new Error('Google Drive did not return a folder id')
    return { fileId, title: cleanString(created.data.name) ?? title, mimeType: GOOGLE_FOLDER_MIME, url: cleanString(created.data.webViewLink) ?? webViewLinkFor(fileId, GOOGLE_FOLDER_MIME), parents: created.data.parents ?? parents }
  }

  if (operation === 'copy_template_doc' || operation === 'copy_template_sheet') {
    const templateId = cleanString(input.templateId) ?? cleanString(input.sourceTemplateArtifactId)
    if (!templateId) throw new Error('templateId is required for template copy broker jobs')
    const copied = await clients.drive.files.copy({
      fileId: templateId,
      requestBody: { name: title, parents: parents.length ? parents : undefined },
      fields: 'id, name, mimeType, webViewLink, parents',
    })
    const fileId = cleanString(copied.data.id)
    if (!fileId) throw new Error('Google Drive did not return a copied file id')
    const mimeType = cleanString(copied.data.mimeType) ?? (operation === 'copy_template_doc' ? GOOGLE_DOC_MIME : GOOGLE_SHEET_MIME)
    return { fileId, title: cleanString(copied.data.name) ?? title, mimeType, url: cleanString(copied.data.webViewLink) ?? webViewLinkFor(fileId, mimeType), parents: copied.data.parents ?? parents }
  }

  if (operation === 'create_doc') {
    const created = await clients.docs.documents.create({ requestBody: { title } })
    const fileId = cleanString(created.data.documentId)
    if (!fileId) throw new Error('Google Docs did not return a document id')
    await moveFileToParents(clients.drive, fileId, parents)
    const text = cleanString(input.markdown) ?? cleanString(input.content)
    if (text) {
      await clients.docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: [{ insertText: { location: { index: 1 }, text } }] } })
    }
    return { fileId, title, mimeType: GOOGLE_DOC_MIME, url: webViewLinkFor(fileId, GOOGLE_DOC_MIME), parents }
  }

  if (operation === 'create_sheet') {
    const created = await clients.sheets.spreadsheets.create({ requestBody: { properties: { title } } })
    const fileId = cleanString(created.data.spreadsheetId)
    if (!fileId) throw new Error('Google Sheets did not return a spreadsheet id')
    await moveFileToParents(clients.drive, fileId, parents)
    return { fileId, title, mimeType: GOOGLE_SHEET_MIME, url: cleanString(created.data.spreadsheetUrl) ?? webViewLinkFor(fileId, GOOGLE_SHEET_MIME), parents }
  }

  throw new Error(`Unsupported Google Workspace broker operation: ${operation}`)
}

async function getArtifactGoogleFile(artifactId: string, purpose: string, brokerOrgId: string): Promise<{ ref: FirebaseFirestore.DocumentReference; artifact: Record<string, unknown>; fileId: string }> {
  const ref = adminDb.collection(WORKSPACE_ARTIFACT_COLLECTION).doc(artifactId)
  const artifactSnap = await ref.get()
  if (!artifactSnap.exists) throw new Error(`Workspace artifact not found for ${purpose}`)
  const artifact = artifactSnap.data() as Record<string, unknown>
  if (cleanString(artifact.orgId) !== cleanString(brokerOrgId)) throw new Error('Workspace artifact orgId does not match broker job orgId')
  const googleInfo = asRecord(artifact.google)
  const fileId = cleanString(googleInfo.fileId)
  if (!fileId) throw new Error('Workspace artifact has no Google file id')
  return { ref, artifact, fileId }
}

async function exportArtifact(job: WorkspaceBrokerJob & { id?: string }, input: Record<string, unknown>, clients: GoogleWorkspaceClients): Promise<{ fileId: string; title: string; mimeType: string; url: string; parents: string[]; size?: string | null }> {
  const artifactId = cleanString(input.artifactId)
  if (!artifactId) throw new Error('artifactId is required for export broker jobs')
  const { artifact, fileId: sourceFileId } = await getArtifactGoogleFile(artifactId, 'export', job.orgId)
  const metadata = await clients.drive.files.get({ fileId: sourceFileId, fields: 'id, name, mimeType, webViewLink, parents' })
  const sourceTitle = cleanString(metadata.data.name) ?? cleanString(artifact.title) ?? 'workspace-export'
  const title = inputTitle(input, `${sourceTitle}.pdf`)
  const exported = await clients.drive.files.export({ fileId: sourceFileId, mimeType: PDF_MIME }, { responseType: 'arraybuffer' })
  const uploaded = await clients.drive.files.create({
    requestBody: { name: title, mimeType: PDF_MIME, parents: parentIds(input) ?? metadata.data.parents ?? undefined },
    media: { mimeType: PDF_MIME, body: Buffer.from(exported.data as ArrayBuffer) },
    fields: 'id, name, mimeType, webViewLink, parents, size',
  })
  const fileId = cleanString(uploaded.data.id)
  if (!fileId) throw new Error('Google Drive did not return an exported file id')
  return { fileId, title: cleanString(uploaded.data.name) ?? title, mimeType: PDF_MIME, url: cleanString(uploaded.data.webViewLink) ?? webViewLinkFor(fileId, PDF_MIME), parents: uploaded.data.parents ?? [], size: cleanString(uploaded.data.size) }
}

async function readArtifactMetadata(job: WorkspaceBrokerJob & { id?: string }, input: Record<string, unknown>, clients: GoogleWorkspaceClients): Promise<WorkspaceBrokerExecutionResult> {
  const artifactId = cleanString(input.artifactId)
  if (!artifactId) throw new Error('artifactId is required for metadata broker jobs')
  const { ref, fileId } = await getArtifactGoogleFile(artifactId, 'metadata refresh', job.orgId)
  const [metadata, permissions] = await Promise.all([
    clients.drive.files.get({ fileId, fields: 'id, name, mimeType, webViewLink, parents, size, owners(emailAddress), modifiedTime' }),
    clients.drive.permissions.list({ fileId, fields: 'permissions(id,type,role,emailAddress,domain,allowFileDiscovery)' }),
  ])
  const permissionRows = permissions.data.permissions ?? []
  const anyoneWithLink = permissionRows.some((permission) => permission.type === 'anyone')
  const externalShared = permissionRows.some((permission) => permission.type === 'user' || permission.type === 'group' || permission.type === 'domain')
  const url = cleanString(metadata.data.webViewLink) ?? webViewLinkFor(fileId, cleanString(metadata.data.mimeType) ?? '')
  const output = {
    fileId,
    title: cleanString(metadata.data.name),
    mimeType: cleanString(metadata.data.mimeType),
    url,
    parents: metadata.data.parents ?? [],
    size: cleanString(metadata.data.size),
    modifiedTime: cleanString(metadata.data.modifiedTime),
    permissions: { anyoneWithLink, externalShared, count: permissionRows.length },
    credentialPathEnv: 'GOOGLE_WORKSPACE_CREDS_JSON_PATH',
  }
  await ref.update({
    google: { fileId, webViewLink: url, parents: metadata.data.parents ?? [], modifiedTime: cleanString(metadata.data.modifiedTime) },
    permissions: { anyoneWithLink, externalShared, providerPermissionCount: permissionRows.length, lastAuditedAt: FieldValue.serverTimestamp() },
    sync: { syncMode: 'metadata_only', syncStatus: 'linked', lastSyncedAt: FieldValue.serverTimestamp(), brokerJobId: job.id ?? null },
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { googleMutationPerformed: false, providerResultIds: [fileId], artifactIds: [artifactId], artifactUrls: url ? [url] : [], output }
}

function artifactTypeFor(mimeType: string) {
  if (mimeType === GOOGLE_FOLDER_MIME) return 'drive_folder'
  if (mimeType === GOOGLE_DOC_MIME) return 'google_doc'
  if (mimeType === GOOGLE_SHEET_MIME) return 'google_sheet'
  if (mimeType === PDF_MIME) return 'export'
  return 'drive_file'
}

async function registerArtifact(job: WorkspaceBrokerJob & { id?: string }, resource: { fileId: string; title: string; mimeType: string; url: string; parents: string[]; size?: string | null }): Promise<string> {
  const input = asRecord(job.input)
  const artifact = normalizeWorkspaceArtifactInput({
    title: resource.title,
    artifactType: artifactTypeFor(resource.mimeType),
    mimeType: resource.mimeType,
    googleFileId: resource.fileId,
    googleUrl: resource.url,
    google: { fileId: resource.fileId, folderId: resource.mimeType === GOOGLE_FOLDER_MIME ? resource.fileId : cleanString(input.parentFolderId) ?? cleanString(input.folderId), webViewLink: resource.url, parents: resource.parents },
    workspaceFolderId: cleanString(input.workspaceFolderId),
    connectionId: cleanString(job.connectionId) ?? cleanString(input.connectionId),
    resourceType: cleanString(input.resourceType),
    resourceId: cleanString(input.resourceId),
    projectId: cleanString(input.projectId),
    taskId: cleanString(input.taskId),
    clientDocumentId: cleanString(input.clientDocumentId),
    sourceDocumentId: cleanString(input.sourceDocumentId),
    sourceDocumentSectionId: cleanString(input.sourceDocumentSectionId),
    sourceSpecVersion: cleanString(input.sourceSpecVersion),
    sourceResearchItemId: cleanString(input.sourceResearchItemId),
    sourceTemplateArtifactId: cleanString(input.templateId) ?? cleanString(input.sourceTemplateArtifactId),
    approvalGateTaskId: cleanString(job.approvalGateTaskId),
    agentId: cleanString(job.agentId),
    visibility: cleanString(input.visibility) ?? 'admin_agents',
    lifecycleStatus: cleanString(input.lifecycleStatus) ?? 'draft',
    capabilityScopes: [job.requiredCapability].filter(Boolean),
    approvalStatus: cleanString(job.approvalStatus),
    riskLevel: cleanString(job.riskLevel),
    safeMetadata: { brokerJobId: job.id ?? null, providerFileId: resource.fileId, size: resource.size ?? null },
    sync: { syncMode: 'metadata_only', syncStatus: 'linked', lastSyncedAt: new Date().toISOString() },
  }, job.orgId)
  const ref = await adminDb.collection(WORKSPACE_ARTIFACT_COLLECTION).add({ ...artifact, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  return ref.id
}

export async function executeWorkspaceBrokerJob(job: WorkspaceBrokerJob & { id?: string }): Promise<WorkspaceBrokerExecutionResult> {
  if (GOOGLE_MUTATION_OPERATIONS.has(job.operation)) {
    const executionGate = canExecuteWorkspaceBrokerJob(job)
    if (!executionGate.ok) throw new Error(executionGate.reason === 'approval_required' ? 'Workspace broker approval evidence is required before execution' : 'Workspace broker job is not ready for execution')
    await assertWorkspaceBrokerExecutionGate(job)
  }
  requiredEnvCredentialPath()
  const input = asRecord(job.input)
  const clients = await buildGoogleWorkspaceClients()
  const createdFileIds: string[] = []
  try {
    if (job.operation === 'permission_audit' || job.operation === 'inventory_refresh') {
      return readArtifactMetadata(job, input, clients)
    }

    const resource = job.operation === 'export_pdf'
      ? await exportArtifact(job, input, clients)
      : await createGoogleResource(job.operation, input, clients)
    createdFileIds.push(resource.fileId)
    const artifactId = await registerArtifact(job, resource)
    return {
      googleMutationPerformed: true,
      providerResultIds: [resource.fileId],
      artifactIds: [artifactId],
      artifactUrls: [resource.url],
      output: { fileId: resource.fileId, url: resource.url, mimeType: resource.mimeType, title: resource.title, parents: resource.parents, credentialPathEnv: 'GOOGLE_WORKSPACE_CREDS_JSON_PATH' },
    }
  } catch (error) {
    for (const fileId of createdFileIds) {
      await clients.drive.files.delete({ fileId }).catch(() => undefined)
    }
    throw error
  }
}
