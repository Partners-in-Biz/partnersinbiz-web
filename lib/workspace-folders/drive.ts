export function parseDriveFolderId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    if (url.hostname !== 'drive.google.com' && !url.hostname.endsWith('.drive.google.com')) return null

    const foldersMatch = url.pathname.match(/\/drive\/folders\/([^/?#]+)/)
    if (foldersMatch?.[1]) return decodeURIComponent(foldersMatch[1])

    const id = url.searchParams.get('id')?.trim()
    return id || null
  } catch {
    return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null
  }
}
