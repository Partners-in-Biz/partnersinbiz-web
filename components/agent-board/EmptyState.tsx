import Link from 'next/link'

type Props = { slug: string }

export function EmptyState({ slug }: Props) {
  return (
    <div className="pib-empty-state">
      <span className="material-symbols-outlined pib-empty-state-icon">smart_toy</span>
      <h2 className="pib-empty-state-title">No agent tasks yet</h2>
      <p className="pib-empty-state-description">
        Ask Pip in the chat to create a task for itself, and it&apos;ll appear here.
      </p>
      <Link
        href={`/admin/org/${slug}/agent`}
        className="btn-pib-secondary mt-6"
      >
        Open Pip chat <span className="material-symbols-outlined text-base">arrow_forward</span>
      </Link>
    </div>
  )
}
