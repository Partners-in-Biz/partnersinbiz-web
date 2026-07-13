import { safePreviewUrl } from '@/lib/chat-context/safeUrl'

describe('safePreviewUrl', () => {
  it('rejects oversized URLs before parsing or exposing them', () => {
    expect(safePreviewUrl(`https://cdn.example.com/${'a'.repeat(2049)}`)).toBeUndefined()
  })

  it('keeps normal HTTPS and relative preview URLs', () => {
    expect(safePreviewUrl('https://cdn.example.com/output.png')).toBe('https://cdn.example.com/output.png')
    expect(safePreviewUrl('/api/files/output.pdf')).toBe('/api/files/output.pdf')
  })
})
