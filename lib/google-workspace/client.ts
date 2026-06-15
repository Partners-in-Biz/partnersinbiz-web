import { google } from 'googleapis'

export const GOOGLE_WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
] as const

export type GoogleWorkspaceCredentialSource =
  | { env: 'GOOGLE_WORKSPACE_CREDS_JSON'; kind: 'json'; credentials: Record<string, unknown> }
  | { env: 'GOOGLE_WORKSPACE_CREDS_JSON_PATH'; kind: 'path'; path: string }

export type PublicGoogleWorkspaceCredentialSource =
  | { env: 'GOOGLE_WORKSPACE_CREDS_JSON'; kind: 'json' }
  | { env: 'GOOGLE_WORKSPACE_CREDS_JSON_PATH'; kind: 'path'; path: string }

export type GoogleWorkspaceClients = {
  auth: InstanceType<typeof google.auth.GoogleAuth>
  drive: ReturnType<typeof google.drive>
  docs: ReturnType<typeof google.docs>
  sheets: ReturnType<typeof google.sheets>
  credentialSource: PublicGoogleWorkspaceCredentialSource
}

function cleanEnv(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function parseServiceAccountJson(value: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('GOOGLE_WORKSPACE_CREDS_JSON must be valid service-account JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('GOOGLE_WORKSPACE_CREDS_JSON must be a JSON object')
  }
  const credentials = parsed as Record<string, unknown>
  if (typeof credentials.client_email !== 'string' || typeof credentials.private_key !== 'string') {
    throw new Error('GOOGLE_WORKSPACE_CREDS_JSON must include client_email and private_key')
  }
  return credentials
}

export function resolveGoogleWorkspaceCredentialSource(): GoogleWorkspaceCredentialSource {
  const rawJson = cleanEnv(process.env.GOOGLE_WORKSPACE_CREDS_JSON)
  if (rawJson) {
    return {
      env: 'GOOGLE_WORKSPACE_CREDS_JSON',
      kind: 'json',
      credentials: parseServiceAccountJson(rawJson),
    }
  }

  const path = cleanEnv(process.env.GOOGLE_WORKSPACE_CREDS_JSON_PATH)
  if (path) {
    return { env: 'GOOGLE_WORKSPACE_CREDS_JSON_PATH', kind: 'path', path }
  }

  throw new Error('GOOGLE_WORKSPACE_CREDS_JSON or GOOGLE_WORKSPACE_CREDS_JSON_PATH is required')
}

export function publicCredentialSource(source: GoogleWorkspaceCredentialSource): PublicGoogleWorkspaceCredentialSource {
  if (source.kind === 'json') return { env: source.env, kind: source.kind }
  return source
}

export async function buildGoogleWorkspaceClients(
  scopes: readonly string[] = GOOGLE_WORKSPACE_SCOPES,
): Promise<GoogleWorkspaceClients> {
  const credentialSource = resolveGoogleWorkspaceCredentialSource()
  const authOptions = credentialSource.kind === 'json'
    ? { credentials: credentialSource.credentials, scopes: [...scopes] }
    : { keyFile: credentialSource.path, scopes: [...scopes] }
  const auth = new google.auth.GoogleAuth(authOptions)

  return {
    auth,
    drive: google.drive({ version: 'v3', auth }),
    docs: google.docs({ version: 'v1', auth }),
    sheets: google.sheets({ version: 'v4', auth }),
    credentialSource: publicCredentialSource(credentialSource),
  }
}
