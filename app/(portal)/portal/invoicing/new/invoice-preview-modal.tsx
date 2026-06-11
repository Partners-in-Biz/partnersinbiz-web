'use client'

import { useEffect, useRef } from 'react'

interface InvoicePreviewModalProps {
  html: string
  onClose: () => void
}

export default function InvoicePreviewModal({ html, onClose }: InvoicePreviewModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument
      if (doc) {
        doc.open()
        doc.write(html)
        doc.close()
      }
    }
  }, [html])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-800">Invoice Preview</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="flex-1 overflow-auto p-1">
          <iframe
            ref={iframeRef}
            className="w-full border-0"
            style={{ height: '80vh' }}
            title="Invoice Preview"
          />
        </div>
      </div>
    </div>
  )
}
