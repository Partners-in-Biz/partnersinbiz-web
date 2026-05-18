/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { LinkedinPixelConfigPanel } from '@/components/ads/LinkedinPixelConfigPanel'

const DEFAULT_PROPS = {
  orgId: 'org_test',
  orgSlug: 'test-org',
  configId: 'pxc_abc123',
  initial: {
    pixelId: '',
    hasCapiToken: false,
    testEventCode: '',
  },
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: {} }),
  }) as unknown as typeof fetch

  // Clipboard mock
  Object.assign(navigator, {
    clipboard: {
      writeText: jest.fn().mockResolvedValue(undefined),
    },
  })
})

afterEach(() => {
  jest.resetAllMocks()
})

describe('LinkedinPixelConfigPanel', () => {
  // Test 1: Renders all 3 inputs + Save button
  it('renders Insight Tag Partner ID, CAPI token, testEventCode inputs and Save button', () => {
    render(<LinkedinPixelConfigPanel {...DEFAULT_PROPS} />)

    expect(screen.getByLabelText(/Insight Tag Partner ID/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/CAPI Token/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Test Event Code/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save changes/i })).toBeInTheDocument()
  })

  // Test 2: CAPI token placeholder reflects hasCapiToken
  it('shows "Not set" placeholder when hasCapiToken is false, and "Set ✓" when true', () => {
    const { rerender } = render(<LinkedinPixelConfigPanel {...DEFAULT_PROPS} />)

    const tokenInput = screen.getByLabelText('CAPI Token')
    expect(tokenInput).toHaveAttribute('placeholder', 'Not set')

    rerender(
      <LinkedinPixelConfigPanel
        {...DEFAULT_PROPS}
        initial={{ ...DEFAULT_PROPS.initial, hasCapiToken: true }}
      />,
    )

    expect(tokenInput).toHaveAttribute(
      'placeholder',
      'Set ✓ (enter new value to replace)',
    )
  })

  // Test 3: Installation snippet only renders when pixelId is non-empty
  it('shows placeholder text when pixelId is empty, shows snippet when pixelId is set', async () => {
    render(<LinkedinPixelConfigPanel {...DEFAULT_PROPS} />)

    // Open the snippet section
    fireEvent.click(screen.getByRole('button', { name: /Installation snippet/i }))

    expect(
      screen.getByText(/Set the Insight Tag Partner ID above to generate the install snippet/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/snap\.licdn\.com/i)).not.toBeInTheDocument()

    // Type a pixelId into the input — snippet should now render
    fireEvent.change(screen.getByLabelText('Insight Tag Partner ID'), {
      target: { value: '12345' },
    })

    expect(screen.getByText(/snap\.licdn\.com/i)).toBeInTheDocument()
    expect(screen.queryByText(/Set the Insight Tag Partner ID above/i)).not.toBeInTheDocument()
  })

  // Test 4: Save sends correct PATCH body
  it('PATCHes /api/v1/ads/pixel-configs/{id} with linkedin body; only includes capiToken when non-empty', async () => {
    render(
      <LinkedinPixelConfigPanel
        {...DEFAULT_PROPS}
        initial={{ pixelId: '99999', hasCapiToken: false, testEventCode: '' }}
      />,
    )

    // Fill in pixelId (pre-filled from initial), test event code
    fireEvent.change(screen.getByLabelText('Insight Tag Partner ID'), {
      target: { value: '99999' },
    })
    fireEvent.change(screen.getByLabelText('Test Event Code'), {
      target: { value: 'TEST_CODE_1' },
    })
    // Leave CAPI token blank

    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/ads/pixel-configs/pxc_abc123',
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({ 'X-Org-Id': 'org_test' }),
          body: expect.stringContaining('"pixelId":"99999"'),
        }),
      )
    })

    // Confirm capiToken is NOT in body when input is empty
    const callBody = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body as string,
    )
    expect(callBody.linkedin.capiToken).toBeUndefined()
    expect(callBody.linkedin.pixelId).toBe('99999')
    expect(callBody.linkedin.testEventCode).toBe('TEST_CODE_1')

    // Now test with a CAPI token provided
    ;(global.fetch as jest.Mock).mockClear()
    fireEvent.change(screen.getByLabelText('CAPI Token'), {
      target: { value: 'secret_token_abc' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }))

    await waitFor(() => {
      const secondBody = JSON.parse(
        (global.fetch as jest.Mock).mock.calls[0][1].body as string,
      )
      expect(secondBody.linkedin.capiToken).toBe('secret_token_abc')
    })
  })

  // Test 5: Success status appears after save
  it('shows success status text after a successful save', async () => {
    render(<LinkedinPixelConfigPanel {...DEFAULT_PROPS} />)

    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Saved successfully/i)
    })
  })
})
