import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { WorkflowGraphAuthoringPanel } from '@/components/projects/WorkflowGraphAuthoringPanel'

const fetchMock = jest.fn()

describe('WorkflowGraphAuthoringPanel per-node model picker (QA render check)', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock
  })

  it('renders agentModel picker with allowlist options after adding an agent node', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { items: [] } }),
    })

    render(<WorkflowGraphAuthoringPanel projectId="proj-1" orgId="pib-platform-owner" />)

    // Wait for the initial template fetch to settle (button enabled after loading)
    const newBtn = screen.getByRole('button', { name: /new template/i })
    await waitFor(() => expect(newBtn).not.toBeDisabled())

    // New template -> blank draft
    fireEvent.click(newBtn)
    // Add an agent node so the per-node controls render
    fireEvent.click(await screen.findByRole('button', { name: /add agent node/i }))

    // The agentModel select should appear with the allowlist options
    const modelSelect = await screen.findByLabelText(/agentModel/i)
    expect(modelSelect).toBeInTheDocument()

    const options = Array.from(modelSelect.querySelectorAll('option')).map((o) => ({
      value: (o as HTMLOptionElement).value,
      text: (o as HTMLOptionElement).text,
    }))
    // Platform default + the seven allowlisted models (canonical registry)
    expect(options[0]?.value).toBe('')
    const values = options.map((o) => o.value).filter(Boolean)
    expect(values).toEqual([
      'grok-4.6',
      'grok-4.5',
      'claude-sonnet-4-6',
      'gpt-5.6-terra',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex-spark',
      'deepseek/deepseek-v4-flash-0731',
    ])
  })

  it('persists the chosen model into the node draft', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { items: [] } }),
    })

    render(<WorkflowGraphAuthoringPanel projectId="proj-1" orgId="pib-platform-owner" />)
    const newBtn = screen.getByRole('button', { name: /new template/i })
    await waitFor(() => expect(newBtn).not.toBeDisabled())
    fireEvent.click(newBtn)
    fireEvent.click(await screen.findByRole('button', { name: /add agent node/i }))

    const modelSelect = await screen.findByLabelText(/agentModel/i)
    fireEvent.change(modelSelect, { target: { value: 'gpt-5.3-codex-spark' } })
    await waitFor(() => {
      expect((modelSelect as HTMLSelectElement).value).toBe('gpt-5.3-codex-spark')
    })
  })
})
