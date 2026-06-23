'use client'

/** Trigger a browser download of a text payload (CSV, disavow file, etc.). */
export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Unwrap the PiB apiSuccess envelope: { success, data } -> data (or throws on error). */
export async function fetchSeo<T = unknown>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init)
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) {
    throw new Error(json?.error ?? `Request failed (${res.status})`)
  }
  return json.data as T
}
