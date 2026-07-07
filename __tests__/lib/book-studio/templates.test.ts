import { BOOK_TEMPLATE_PRESETS, getBookTemplatePreset } from '@/lib/book-studio/templates'
import { getBookFormat } from '@/lib/book-studio/format-registry'

describe('book template presets', () => {
  it('every preset maps to a real format', () => {
    for (const preset of BOOK_TEMPLATE_PRESETS) {
      expect(getBookFormat(preset.format)).not.toBeNull()
    }
  })
  it('lead magnet scaffolds hook-first chapters', () => {
    const preset = getBookTemplatePreset('lead_magnet')
    expect(preset?.format).toBe('nonfiction')
    expect(preset?.starterChapters?.[0]?.title).toBe('Hook')
  })
  it('unknown id returns null', () => {
    expect(getBookTemplatePreset('nope')).toBeNull()
  })
})
