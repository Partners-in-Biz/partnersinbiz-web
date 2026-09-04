'use client'

import { useEffect, useState } from 'react'
import type { FilePartV2 } from '@/lib/chat/parts'
import { isAllowedPartUrl } from '@/lib/chat/allowed-part-url'
import { PartStatusBox } from './status-box'

function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function parseCsvRows(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0).slice(0, 50)
  return lines.map((line) => {
    const cells: string[] = []
    let cell = ''
    let inQuotes = false
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]
      if (char === '"') {
        if (inQuotes && line[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        cells.push(cell)
        cell = ''
      } else {
        cell += char
      }
    }
    cells.push(cell)
    return cells
  })
}

function DownloadRow({ part }: { part: FilePartV2 }) {
  const size = formatBytes(part.size)
  return (
    <a
      href={part.url}
      target="_blank"
      rel="noreferrer"
      download
      className="my-2 flex items-center gap-2 rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] px-3 py-2 text-xs transition hover:border-primary/70"
    >
      <span className="min-w-0 flex-1 truncate">{part.name}</span>
      {part.contentType && <span className="shrink-0 opacity-60">{part.contentType}</span>}
      {size && <span className="shrink-0 opacity-60">{size}</span>}
    </a>
  )
}

export function FilePart({ part }: { part: FilePartV2 }) {
  const [csvRows, setCsvRows] = useState<string[][] | null>(null)
  const allowed = isAllowedPartUrl(part.url)
  const contentType = (part.contentType || '').toLowerCase()
  const isPdf = contentType.includes('pdf') || part.name.toLowerCase().endsWith('.pdf')
  const isImage = contentType.startsWith('image/')
  const isCsv = contentType.includes('csv') || part.name.toLowerCase().endsWith('.csv')

  useEffect(() => {
    if (!allowed || !isCsv) return
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(part.url)
        if (!response.ok) return
        const text = await response.text()
        if (!cancelled) setCsvRows(parseCsvRows(text))
      } catch {
        if (!cancelled) setCsvRows(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [allowed, isCsv, part.url])

  if (!allowed) {
    return <PartStatusBox>Unsupported content</PartStatusBox>
  }

  if (isPdf) {
    return (
      <div data-testid="file-part" className="my-2 overflow-hidden rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)]">
        <iframe
          sandbox=""
          src={`${part.url}#toolbar=0`}
          title={part.name}
          referrerPolicy="no-referrer"
          className="block w-full border-0"
          style={{ height: 420 }}
        />
        <DownloadRow part={part} />
      </div>
    )
  }

  if (isImage) {
    const src = part.previewUrl && isAllowedPartUrl(part.previewUrl) ? part.previewUrl : part.url
    return (
      <figure data-testid="file-part" className="my-2 overflow-hidden rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={part.name} className="max-h-72 w-full object-contain" />
        <DownloadRow part={part} />
      </figure>
    )
  }

  if (isCsv && csvRows && csvRows.length > 0) {
    const headers = csvRows[0]
    const body = csvRows.slice(1)
    return (
      <div data-testid="file-part" className="my-2 overflow-hidden rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)]">
        <div className="my-3 max-w-full overflow-x-auto shadow-sm">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-[var(--color-pib-surface-muted)] text-[var(--color-pib-text)]">
              <tr>
                {headers.map((header, index) => (
                  <th
                    key={`${header}-${index}`}
                    scope="col"
                    className="border-b border-[var(--color-pib-line)] px-3 py-2 align-top text-xs font-medium"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 text-[var(--color-pib-text-muted)]">
              {body.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`} className="align-top">
                  {headers.map((_, cellIndex) => (
                    <td
                      key={`cell-${rowIndex}-${cellIndex}`}
                      className="max-w-[20rem] break-words px-3 py-2 leading-relaxed [overflow-wrap:anywhere]"
                    >
                      {row[cellIndex] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DownloadRow part={part} />
      </div>
    )
  }

  return (
    <div data-testid="file-part">
      <DownloadRow part={part} />
    </div>
  )
}
