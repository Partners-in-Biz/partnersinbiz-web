'use client'

import type { BrowserFramePart as BrowserFramePartModel } from '@/lib/chat/parts'
import { isAllowedPartUrl } from '@/lib/chat/allowed-part-url'
import { PartStatusBox } from './status-box'

export function BrowserFramePart({
  part,
  onTakeOver,
}: {
  part: BrowserFramePartModel
  onTakeOver?: () => void
}) {
  const screenshotOk = isAllowedPartUrl(part.screenshotUrl)
  const pageOk = isAllowedPartUrl(part.url)

  if (!screenshotOk && !pageOk) {
    return <PartStatusBox>Unsupported content</PartStatusBox>
  }

  return (
    <figure
      data-testid="browser-frame-part"
      className="my-2 overflow-hidden rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)]"
    >
      {screenshotOk && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={part.screenshotUrl} alt={part.url || 'Browser frame'} className="max-h-80 w-full object-cover object-top" />
      )}
      <figcaption className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        {pageOk ? (
          <a
            href={part.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate text-xs text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
          >
            {part.url}
          </a>
        ) : (
          <span className="min-w-0 truncate text-xs text-[var(--color-pib-text-muted)]">Browser session</span>
        )}
        <button
          type="button"
          onClick={() => onTakeOver?.()}
          className="shrink-0 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"
        >
          Take over
        </button>
      </figcaption>
    </figure>
  )
}
