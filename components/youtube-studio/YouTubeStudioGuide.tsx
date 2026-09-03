'use client'

const PIPELINE_STEPS = [
  {
    title: 'Connect your channel',
    body: 'Link your YouTube channel via Google OAuth. The same connection powers Marketing Studio social posting and YouTube Studio publishing & analytics.',
  },
  {
    title: 'Plan series & videos',
    body: 'Request videos or set up recurring series. Every video moves through a visible pipeline from idea to live.',
  },
  {
    title: 'Produce the content',
    body: 'PiB produces scripts, drafts and renders - in Marketing Studio or the Video Editor - and sends each stage to you for review.',
  },
  {
    title: 'Approve & publish',
    body: 'You approve the final packet (title, description, thumbnail, disclosure checks) and PiB publishes on schedule.',
  },
] as const

interface YouTubeStudioGuideProps {
  oauthHref: string
}

export function YouTubeStudioGuide({ oauthHref }: YouTubeStudioGuideProps) {
  return (
    <section className="pib-card-section space-y-6 p-6">
      <div>
        <h2 className="font-headline text-xl text-[var(--color-pib-text)]">How YouTube Studio works</h2>
        <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
          A guided pipeline from channel connection to published video. Start by linking your channel.
        </p>
      </div>
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PIPELINE_STEPS.map((step, index) => (
          <li key={step.title} className="rounded-[6px] border border-[var(--color-pib-line)] p-4">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-[color-mix(in_srgb,var(--st-danger)_10%,transparent)] text-sm text-[var(--st-danger)]">
              {index + 1}
            </span>
            <h3 className="mt-3 text-[var(--color-pib-text)]">{step.title}</h3>
            <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{step.body}</p>
          </li>
        ))}
      </ol>
      <a href={oauthHref} className="pib-btn-primary inline-flex justify-center text-center">
        Link YouTube channel
      </a>
    </section>
  )
}
