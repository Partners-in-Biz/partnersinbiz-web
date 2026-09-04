'use client'

import type { HtmlArtifactPart as HtmlArtifactPartModel } from '@/lib/chat/parts'

const CSP = "default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline'; font-src data:;"

export function wrapHtmlArtifact(html: string): string {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}"><base target="_blank"></head><body>${html}</body></html>`
}

function clampHeight(height: number | undefined): number {
  const raw = typeof height === 'number' && Number.isFinite(height) ? height : 360
  return Math.min(1200, Math.max(120, raw))
}

export function HtmlArtifactPart({
  part,
  onOpenArtifact,
}: {
  part: HtmlArtifactPartModel
  onOpenArtifact?: (part: HtmlArtifactPartModel) => void
}) {
  const height = clampHeight(part.height)
  const wrapped = wrapHtmlArtifact(part.html)
  const showCanvas = height > 480

  return (
    <div data-testid="html-artifact-part" className="my-2 overflow-hidden rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-pib-line)] px-3 py-2">
        <p className="min-w-0 truncate text-xs font-medium text-[var(--color-pib-text)]">{part.title}</p>
        {showCanvas && (
          <button
            type="button"
            onClick={() => onOpenArtifact?.(part)}
            className="shrink-0 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"
          >
            Open in canvas
          </button>
        )}
      </div>
      <iframe
        sandbox=""
        srcDoc={wrapped}
        referrerPolicy="no-referrer"
        loading="lazy"
        title={part.title}
        style={{ height, width: '100%', border: 0, display: 'block' }}
      />
    </div>
  )
}
