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
    return (
      <div className="p-6">
        <div className="h-screen rounded-xl bg-surface-container animate-pulse" />
      </div>
    )
  }

  if (error || !template) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="card p-8 text-center">
          <h2 className="text-lg font-semibold mb-2">Could not load template</h2>
          <p className="text-sm text-on-surface-variant mb-4">{error ?? 'Unknown error'}</p>
          <button
            onClick={() => router.push('/portal/email-templates')}
            className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm"
          >
            Back to templates
          </button>
        </div>
      </div>
    )
  }

  return <TemplateEditor template={template} />
}
