import { render, screen } from '@testing-library/react'
import { Button, Choice, Field, Input, Notice, Status, Steps } from '@/components/studio'

describe('Studio UI primitives', () => {
  it('Field links its label to the control so the design-audit gate passes', () => {
    render(
      <Field id="email" label="Email" hint="Optional" help="We never share it.">
        <Input id="email" type="email" />
      </Field>,
    )
    const input = screen.getByLabelText(/email/i)
    expect(input).toHaveAttribute('id', 'email')
    expect(screen.getByText('We never share it.')).toHaveClass('st-help')
  })

  it('Field renders an error as an alert and drops the help text', () => {
    render(
      <Field id="name" label="Name" help="Full name" error="Required">
        <Input id="name" invalid />
      </Field>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Required')
    expect(screen.queryByText('Full name')).toBeNull()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
  })

  it('Button is disabled and busy while loading, defaults to type=button', () => {
    render(<Button loading>Save</Button>)
    const button = screen.getByRole('button', { name: /save/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('st-btn', 'st-btn--primary')
  })

  it('Choice exposes selection through aria-pressed', () => {
    render(<Choice selected>09:00</Choice>)
    expect(screen.getByRole('button', { name: '09:00' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('Steps marks the current step', () => {
    render(<Steps steps={['Date', 'Time', 'Details']} current={1} />)
    const current = screen.getByText(/02 Time/)
    expect(current).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText(/01 Date/)).toHaveClass('st-steps__item--done')
  })

  it('Notice with a danger tone is an alert; Status carries its tone class', () => {
    render(
      <>
        <Notice tone="danger">Failed</Notice>
        <Status tone="success">Live</Status>
      </>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Failed')
    expect(screen.getByText('Live')).toHaveClass('st-status--success')
  })
})
