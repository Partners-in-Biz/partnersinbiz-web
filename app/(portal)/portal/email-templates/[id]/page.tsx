'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import TemplateEditor from '@/components/admin/email-builder/TemplateEditor'
import { EmptyState } from '@/components/ui/AppFoundation'
import { Skeleton, Button } from '@/components/studio'
import type { EmailTemplate } from '@/lib/email-builder/templates'

export default function EmailTemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [template, setTemplate] = useState<EmailTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    params.then((p) => {
      fetch(`/api/v1/email-templates/${p.id}`)
        .then((r) => r.json())
        .then((b) => {
          if (b?.success === false) {
            setError(b.error ?? 'Failed to load')
          } else if (b?.data) {
            setTemplate(b.data)
          } else {
            setError('Template not found')
          }
        })
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false))
    })
  }, [params])

  if (loading) {
    return <Skeleton height="100vh" />
  }

  if (error || !template) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="Could not load template."
          description={error ?? 'Unknown error.'}
          action={
            <Button variant="secondary" onClick={() => router.push('/portal/email-templates')}>
              Back to templates
            </Button>
          }
        />
      </div>
    )
  }

  return <TemplateEditor template={template} />
}
