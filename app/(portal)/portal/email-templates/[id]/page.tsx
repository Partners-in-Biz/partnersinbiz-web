'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import TemplateEditor from '@/components/admin/email-builder/TemplateEditor'
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
    return <div className="pib-skeleton h-screen" />
  }

  if (error || !template) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="pib-empty-state">
          <span aria-hidden="true" className="material-symbols-outlined pib-empty-state-icon">mail</span>
          <h2 className="pib-empty-state-title">Could not load template</h2>
          <p className="pib-empty-state-description">{error ?? 'Unknown error'}</p>
          <div className="mt-5 flex justify-center">
            <button onClick={() => router.push('/portal/email-templates')} className="btn-pib-secondary">
              Back to templates
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <TemplateEditor template={template} />
}
