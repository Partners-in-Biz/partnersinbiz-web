'use client'

import { useState } from 'react'
import { DocumentLinkPicker } from '@/components/client-documents/DocumentLinkPicker'

export function EmailCampaignDocumentLinker() {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  function handleSelect(href: string, label: string) {
    const baseUrl = window.location.origin
    const fullUrl = `${baseUrl}${href}`
    const linkHtml = `<a href="${fullUrl}">${label}</a>`

    // Copy formatted link to clipboard
    if (navigator.clipboard) {
      navigator.clipboard.writeText(linkHtml).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      })
    }

    setOpen(false)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors w-full justify-center"
        style={{
          background: 'var(--color-pib-surface-2)',
          border: '1px solid var(--color-pib-line)',
          color: 'var(--color-pib-text)',
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-pib-accent)'
          ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--color-pib-accent)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-pib-line)'
          ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--color-pib-text)'
        }}
      >
        <span className="material-symbols-outlined text-base" aria-hidden="true">
          attach_file
        </span>
        {copied ? 'Link copied to clipboard!' : 'Insert document link'}
      </button>

      <DocumentLinkPicker
        open={open}
        onClose={() => setOpen(false)}
        onSelect={handleSelect}
      />
    </>
  )
}
