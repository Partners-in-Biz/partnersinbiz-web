import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'

type Content = { headers?: string[]; rows?: string[][] }

export function TableBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const content = (block.content as Content) ?? {}
  const headers: string[] = content.headers ?? []
  const rows: string[][] = content.rows ?? []
  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-6 text-2xl font-medium text-[var(--doc-accent)] md:text-4xl">
          {block.title}
        </h2>
      )}
      <div
        className="max-w-full overflow-x-auto rounded border"
        style={{ borderColor: 'var(--doc-border)' }}
      >
        <table className="min-w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--doc-accent-soft)' }}>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="px-4 py-3 text-left font-medium break-words text-[var(--doc-accent)]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                style={{ background: ri % 2 ? 'var(--doc-surface)' : 'transparent' }}
              >
                {row.map((cell, ci) => (
                  <td key={ci} className="px-4 py-3 break-words text-[var(--doc-text)]">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BlockFrame>
  )
}
