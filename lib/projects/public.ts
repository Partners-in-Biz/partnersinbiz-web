const PRIVATE_PROJECT_FIELDS = [
  'claimToken',
  'projectFolderRelativePath',
  'workspaceFolderId',
  'executionLocationIds',
  'canonicalLocationId',
] as const

/** Remove bearer credentials and server-side filesystem/runtime bindings. */
export function publicProjectView<T extends Record<string, unknown>>(project: T): Omit<T, typeof PRIVATE_PROJECT_FIELDS[number]> {
  const safe = { ...project }
  for (const field of PRIVATE_PROJECT_FIELDS) delete safe[field]
  return safe
}
