/**
 * Join a company/org Cowork root with a folder-relative path without nesting.
 *
 * Project replicas store paths relative to the VPS Cowork mapping root
 * (`partners/{Company}/…`). Conversation workspace context often re-roots to the
 * company folder (`…/partners/{Company}`). Naively joining those produces:
 *   …/Hunt and Gun/partners/Hunt and Gun/hunt-and-gun-seller-crm
 * which Hermes then rejects (or the linked runtime creates as root-owned 0700
 * and Hermes hits PermissionError → HTTP 500).
 */
export function joinCoworkWorkingPath(
  rootPath: string,
  folderRelativePath?: string | null,
): string {
  const root = rootPath.trim().replace(/\/+$/, '')
  const relative = (folderRelativePath ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '')
  if (!root) return relative
  if (!relative) return root

  // Already an absolute/portable path under this root (mis-tagged relative).
  if (relative === root || relative.startsWith(`${root}/`)) return relative

  const rootSegments = root.split('/').filter(Boolean)
  const companyName = rootSegments[rootSegments.length - 1] || ''
  const underPartners = rootSegments.length >= 2
    && rootSegments[rootSegments.length - 2] === 'partners'

  if (companyName && companyName !== 'partners' && companyName !== 'Cowork') {
    const partnersPrefix = `partners/${companyName}/`
    if (relative.startsWith(partnersPrefix)) {
      const rest = relative.slice(partnersPrefix.length)
      return rest ? `${root}/${rest}` : root
    }
    if (relative === `partners/${companyName}`) return root

    // Relative "Hunt and Gun/…" when root is already …/partners/Hunt and Gun
    if (underPartners) {
      const namePrefix = `${companyName}/`
      if (relative.startsWith(namePrefix)) {
        const rest = relative.slice(namePrefix.length)
        return rest ? `${root}/${rest}` : root
      }
      if (relative === companyName) return root
    }
  }

  return `${root}/${relative}`
}

/**
 * Collapse accidental double-nested company paths already stored on a conversation.
 * Safe no-op when the path is already canonical.
 */
export function collapseNestedCoworkWorkingPath(directory: string): string {
  const value = directory.trim()
  if (!value) return value

  // …/partners/{Name}/partners/{Name}/… → …/partners/{Name}/…
  const nestedPartners = value.replace(
    /\/partners\/([^/]+)\/partners\/\1(?=\/|$)/g,
    '/partners/$1',
  )
  // …/{Name}/{Name}/… only when parent is partners (avoid collapsing normal dirs)
  const nestedName = nestedPartners.replace(
    /\/partners\/([^/]+)\/\1(?=\/|$)/g,
    '/partners/$1',
  )
  return nestedName
}
