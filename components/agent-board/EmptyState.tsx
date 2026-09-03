import Link from 'next/link'

import { Icon } from '@/components/studio'

type Props = { slug: string }

export function EmptyState({ slug }: Props) {
  return (
    <div className="pib-empty-state">
      <Icon name="smart_toy" className="pib-empty-state-icon" />
      <h2 className="pib-empty-state-title">No agent tasks yet</h2>
      <p className="pib-empty-state-description">
        Ask Pip in the chat to create a task for itself, and it&apos;ll appear here.
      </p>
      <Link
        href={`/admin/org/${slug}/agent`}
        className="btn-pib-secondary mt-6"
      >
        Open Pip chat <Icon name="arrow_forward" className="text-base" />
      </Link>
    </div>
  )
}
