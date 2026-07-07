import type { BookFormatId } from './format-registry'

export interface BookTemplatePreset {
  id: string
  label: string
  description: string
  format: BookFormatId
  starterChapters?: { title: string }[]
  stage?: string
}

export const BOOK_TEMPLATE_PRESETS: BookTemplatePreset[] = [
  {
    id: 'nonfiction_book', label: 'Non-fiction book',
    description: 'Long-form expertise, proof, structure, and launch packet.',
    format: 'nonfiction',
    starterChapters: [{ title: 'Introduction' }, { title: 'Chapter 1' }, { title: 'Conclusion' }],
  },
  {
    id: 'lead_magnet', label: 'Lead magnet',
    description: 'Short-form guide, checklist, or report used for acquisition.',
    format: 'nonfiction',
    starterChapters: [{ title: 'Hook' }, { title: 'Problem' }, { title: 'Framework' }, { title: 'Next step' }],
  },
  {
    id: 'case_study', label: 'Case study',
    description: 'Client-safe narrative, proof, outcomes, and approval trail.',
    format: 'nonfiction',
    starterChapters: [{ title: 'Client context' }, { title: 'Challenge' }, { title: 'Approach' }, { title: 'Results' }, { title: 'Proof' }],
  },
  {
    id: 'playbook', label: 'Playbook',
    description: 'Repeatable process, operating model, or implementation guide.',
    format: 'nonfiction',
    starterChapters: [{ title: 'Overview' }, { title: 'Process' }, { title: 'Checklists' }],
  },
  {
    id: 'publishing_packet', label: 'Publishing packet',
    description: 'Metadata, files, evidence, rights, and release checklist.',
    format: 'nonfiction',
    stage: 'publishing_packet',
  },
]

export function getBookTemplatePreset(id: string): BookTemplatePreset | null {
  return BOOK_TEMPLATE_PRESETS.find((preset) => preset.id === id) ?? null
}
