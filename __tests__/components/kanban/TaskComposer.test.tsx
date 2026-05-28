import { fireEvent, render, screen } from '@testing-library/react'
import { TaskComposer } from '@/components/kanban/TaskComposer'

jest.mock('@/components/chat/VoiceInputButton', () => ({
  __esModule: true,
  default: ({ onTranscript, disabled }: { onTranscript: (text: string) => void; disabled?: boolean }) => (
    <button type="button" aria-label="Dictate task description" disabled={disabled} onClick={() => onTranscript('spoken acceptance criteria')}>
      Mock mic
    </button>
  ),
}))

describe('TaskComposer voice input', () => {
  it('adds dictated text to the new task description', () => {
    render(
      <TaskComposer
        open
        column={{ id: 'todo', name: 'To do', color: '#60a5fa', order: 1 }}
        projectId="project-1"
        orgId="org-1"
        members={[]}
        agents={[]}
        existingTasks={[]}
        onClose={jest.fn()}
        onCreated={jest.fn()}
      />,
    )

    const description = screen.getByPlaceholderText('Description, goals, acceptance criteria, blockers...')
    fireEvent.change(description, { target: { value: 'Existing notes.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Dictate task description' }))

    expect(description).toHaveValue('Existing notes.\n\nspoken acceptance criteria')
  })
})
