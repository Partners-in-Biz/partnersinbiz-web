import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'
import { CheckIcon, CrossIcon } from './_icons'

type Row = { label: string; values: (string | boolean)[] }
type Content = { headers: string[]; rows: Row[]; highlightCol?: number }

export function ComparisonBlock({
  block,
  index,
}: {
  block: DocumentBlock
  index: number
}) {
  const content = (block.content as Content) ?? { headers: [], rows: [] }
  const highlight = content.highlightCol ?? -1
  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-6 text-2xl font-medium text-[var(--doc-accent)] md:text-4xl">
          {block.title}
        </h2>
      )}
      <div
        className="max-w-full overflow-x-auto rounded-lg border"
        style={{ borderColor: 'var(--doc-border)' }}
      >
        <table className="min-w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--doc-surface)' }}>
              <th className="px-4 py-3 text-left" />
              {content.headers.map((h, i) => (
                <th
                  key={i}
                  className="px-4 py-3 text-center font-medium break-words"
                  style={{
                    background: i === highlight ? 'var(--doc-accent-soft)' : undefined,
                    color: i === highlight ? 'var(--doc-accent)' : 'var(--doc-text)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {content.rows.map((row, ri) => (
              <tr key={ri} className="border-t" style={{ borderColor: 'var(--doc-border)' }}>
                <td className="px-4 py-3 break-words text-[var(--doc-text)]">{row.label}</td>
                {row.values.map((v, ci) => (
                  <td
                    key={ci}
                    className="px-4 py-3 text-center break-words text-[var(--doc-text)]"
                    style={{
                      background: ci === highlight ? 'var(--doc-accent-soft)' : undefined,
                    }}
                  >
                    {typeof v === 'boolean' ? (
                      v ? (
                        <CheckIcon
                          className="mx-auto h-4 w-4"
                          style={{ color: 'var(--doc-accent)' }}
                        />
                      ) : (
                        <CrossIcon className="mx-auto h-4 w-4 opacity-40" />
                      )
                    ) : (
                      v
                    )}
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
