import { stripDurableArtifactUrls } from './artifacts'

const PRIVATE_FIELDS = new Set([
  'createdBy',
  'createdByType',
  'updatedBy',
  'updatedByType',
  'shareToken',
  'shareEnabled',
  'editShareToken',
  'editAccessCode',
  'editShareEnabled',
  'userShares',
  'userShareUserIds',
  'sharedWithUserIds',
  'providerSignature',
  'clientAcceptance',
  'deleted',
  'signToken',
  'signatureImage',
  'pdfSnapshotUrl',
  'downloadUrl',
  'signedUrl',
  'artifactUrl',
])

export function stripPrivateDocumentFields(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input
  if (Array.isArray(input)) return input.map(stripPrivateDocumentFields)

  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (PRIVATE_FIELDS.has(key)) continue

    if (key === 'assumptions' && Array.isArray(value)) {
      output.assumptions = value
        .filter((assumption) => {
          return (
            assumption &&
            typeof assumption === 'object' &&
            !Array.isArray(assumption) &&
            (assumption as Record<string, unknown>).severity === 'info'
          )
        })
        .map(stripPrivateDocumentFields)
      continue
    }

    output[key] = stripPrivateDocumentFields(value)
  }

  return stripDurableArtifactUrls(output)
}
