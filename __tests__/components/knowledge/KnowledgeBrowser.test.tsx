import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { KnowledgeBrowser } from '@/components/knowledge/KnowledgeBrowser'

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

function textResponse(body: string, status = 500) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'text/plain' },
    json: async () => {
      throw new SyntaxError(`Unexpected token 'I', "${body.slice(0, 10)}" is not valid JSON`)
    },
    text: async () => body,
  } as Response
}

describe('KnowledgeBrowser graph loading', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('shows a readable backend error when graph fetch returns non-JSON text', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: { items: [{ type: 'file', path: 'home.md', name: 'home.md' }] },
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: { path: 'home.md', name: 'home.md', content: '# Home\n\n[[Missing]]' },
      }))
      .mockResolvedValueOnce(textResponse('Internal Server Error'))

    global.fetch = fetchMock as unknown as typeof fetch

    render(
      <KnowledgeBrowser
        scope="shared"
        title="Knowledge"
        eyebrow="Internal"
        description="Internal knowledge"
        sections={['wiki']}
      />,
    )

    expect(await screen.findByText('home')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Graph'))

    expect(await screen.findByText('Knowledge backend is not available')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText(/Unexpected token/)).not.toBeInTheDocument()
    })
  })
})
