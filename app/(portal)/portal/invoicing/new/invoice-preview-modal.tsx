'use client'

import { useEffect, useRef } from 'react'
import { DialogDrawer } from '@/components/ui/AppFoundation'

interface InvoicePreviewModalProps {
  html: string
  onClose: () => void
  open?: boolean
}

export default function InvoicePreviewModal({ html, onClose, open = true }: InvoicePreviewModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!open || !iframeRef.current) return
    const doc = iframeRef.current.contentDocument
    if (doc) {
      doc.open()
      doc.write(html)
      doc.close()
    }
  }, [html, open])

  return (
    <DialogDrawer open={open} title="Invoice preview" onClose={onClose}>
      <iframe
        ref={iframeRef}
        className="w-full border-0"
        style={{ height: '70vh', background: 'var(--sc-canvas)' }}
        title="Invoice preview"
      />
    </DialogDrawer>
  )
}
