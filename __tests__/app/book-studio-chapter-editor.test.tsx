import React from 'react'
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'
import { BookProjectChaptersPanel } from '@/components/book-studio/project/BookProjectChaptersPanel'
import type { BookChapter } from '@/components/book-studio/project/types'

// TipTap's ProseMirror-backed editor does not meaningfully simulate typed
// input via fireEvent in jsdom (contenteditable + Range/Selection support is
// incomplete), and this repo has no existing BlogEditor test to mirror. The
// panel's contract — sidebar, statuses, autosave-driven status promotion,
// readOnly gating, and the request-draft affordance — is what Task 8 needs
// covered, not TipTap's internal ProseMirror behavior (which is exercised by
// the library's own test suite upstream). So @tiptap/react is mocked here
// with a controlled <textarea> stand-in that fires the same onUpdate/content
// callbacks the real ChapterEditor relies on, keeping ChapterEditor's own
// autosave/debounce/flush logic under real test rather than re-implementing it.
jest.mock('@tiptap/react', () => {
  const React = require('react')
  return {
    useEditor: ({ content, onUpdate, editable }: { content: string; onUpdate?: (arg: { editor: unknown }) => void; editable: boolean }) => {
      const [value, setValue] = React.useState(content)
      const editorRef = React.useRef<{ getMarkdown: () => string; text: string } | null>(null)

      const editor = React.useMemo(() => {
        const instance = {
          storage: { markdown: { getMarkdown: () => editorRef.current?.text ?? '' } },
          isActive: () => false,
          chain: () => ({
            focus: () => ({
              toggleHeading: () => ({ run: () => {} }),
              toggleBold: () => ({ run: () => {} }),
              toggleItalic: () => ({ run: () => {} }),
              toggleBulletList: () => ({ run: () => {} }),
              toggleOrderedList: () => ({ run: () => {} }),
              toggleBlockquote: () => ({ run: () => {} }),
              setHorizontalRule: () => ({ run: () => {} }),
              undo: () => ({ run: () => {} }),
              redo: () => ({ run: () => {} }),
            }),
          }),
          getText: () => editorRef.current?.text ?? '',
          commands: {
            setContent: (next: string) => {
              editorRef.current = { getMarkdown: () => next, text: next }
              setValue(next)
            },
          },
          setEditable: () => {},
          __setText: (next: string) => {
            editorRef.current = { getMarkdown: () => next, text: next }
          },
          __value: value,
          __editable: editable,
          __onUpdate: onUpdate,
        }
        editorRef.current = { getMarkdown: () => value, text: value }
        return instance
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [value, editable])

      return editor
    },
    EditorContent: ({ editor }: { editor: any }) => {
      return (
        <textarea
          aria-label="chapter-body"
          disabled={!editor.__editable}
          defaultValue={editor.__value}
          onChange={(event) => {
            editor.__setText(event.target.value)
            editor.__onUpdate?.({ editor })
          }}
        />
      )
    },
  }
})

jest.mock('@tiptap/starter-kit', () => ({ __esModule: true, default: { configure: () => ({}) } }))
jest.mock('@tiptap/extension-link', () => ({
  __esModule: true,
  default: { configure: () => ({}) },
}))
jest.mock('@tiptap/extension-placeholder', () => ({
  __esModule: true,
  default: { configure: () => ({}) },
}))
jest.mock('tiptap-markdown', () => ({ Markdown: { configure: () => ({}) } }))

const chapters: BookChapter[] = [
  { id: 'c1', title: 'Chapter One', order: 0, body: 'Hello world', status: 'generated', wordCount: 2 },
  { id: 'c2', title: 'Chapter Two', order: 1, body: 'Second chapter body here', status: 'draft' },
]

function noop() {}

describe('BookProjectChaptersPanel + ChapterEditor', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('renders the sidebar with chapters, word counts, and statuses', () => {
    render(
      <BookProjectChaptersPanel
        chapters={chapters}
        onEditBody={noop}
        onEditStatus={noop}
        onAddChapter={noop}
        addingChapter={false}
      />,
    )

    const list = screen.getByRole('list', { name: 'Book chapters' })
    expect(within(list).getByText('Chapter One')).toBeInTheDocument()
    expect(within(list).getByText('Chapter Two')).toBeInTheDocument()
    expect(within(list).getByText('2 words')).toBeInTheDocument()
    // Chapter Two has no wordCount, so it falls back to a local count of its body.
    expect(within(list).getByText('4 words')).toBeInTheDocument()
    expect(screen.getByText('Total words: 6')).toBeInTheDocument()
  })

  it('debounced save triggers onEditBody and promotes a generated chapter to edited', async () => {
    const onEditBody = jest.fn().mockResolvedValue(undefined)
    const onEditStatus = jest.fn().mockResolvedValue(undefined)

    render(
      <BookProjectChaptersPanel
        chapters={chapters}
        onEditBody={onEditBody}
        onEditStatus={onEditStatus}
        onAddChapter={noop}
        addingChapter={false}
      />,
    )

    const textarea = screen.getByLabelText('chapter-body')
    fireEvent.change(textarea, { target: { value: 'Hello world, edited' } })

    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')

    await act(async () => {
      jest.advanceTimersByTime(2000)
    })

    await waitFor(() => expect(onEditBody).toHaveBeenCalledWith('c1', 'Hello world, edited'))
    await waitFor(() => expect(onEditStatus).toHaveBeenCalledWith('c1', 'edited'))
  })

  it('readOnly hides add-chapter form and disables the editor', () => {
    render(
      <BookProjectChaptersPanel
        chapters={chapters}
        onEditBody={noop}
        onEditStatus={noop}
        onAddChapter={noop}
        addingChapter={false}
        readOnly
      />,
    )

    expect(screen.queryByPlaceholderText('New chapter title')).not.toBeInTheDocument()
    expect(screen.getByLabelText('chapter-body')).toBeDisabled()
  })

  it('filters the approved status option when canApprove is false', () => {
    render(
      <BookProjectChaptersPanel
        chapters={chapters}
        onEditBody={noop}
        onEditStatus={noop}
        onAddChapter={noop}
        addingChapter={false}
        canApprove={false}
      />,
    )

    const select = screen.getByLabelText('Status') as HTMLSelectElement
    const values = Array.from(select.options).map((option) => option.value)
    expect(values).not.toContain('approved')
  })

  it('calls onRequestDraft with the selected chapter id', () => {
    const onRequestDraft = jest.fn().mockResolvedValue(undefined)
    render(
      <BookProjectChaptersPanel
        chapters={chapters}
        onEditBody={noop}
        onEditStatus={noop}
        onAddChapter={noop}
        addingChapter={false}
        onRequestDraft={onRequestDraft}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Request AI draft' }))
    expect(onRequestDraft).toHaveBeenCalledWith('c1')

    // Switch chapter and verify the id passed changes accordingly.
    fireEvent.click(screen.getByText('Chapter Two'))
    fireEvent.click(screen.getByRole('button', { name: 'Request AI draft' }))
    expect(onRequestDraft).toHaveBeenCalledWith('c2')
  })
})
