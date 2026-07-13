export function bookOutputAnchor(file: { id?: unknown; role?: unknown }, index: number): string {
  const identity = typeof file.id === 'string' && file.id.trim()
    ? file.id.trim()
    : typeof file.role === 'string' && file.role.trim()
      ? file.role.trim()
      : 'output'
  return `output-${encodeURIComponent(`${identity}:${index}`)}`
}
