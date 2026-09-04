import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { ThemeToggle } from '@/components/theme/ThemeToggle'

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  )
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('is an icon-only control and keeps Paper and Ink off the visible label', () => {
    renderToggle()

    const button = screen.getByRole('button', { name: 'Switch to Ink' })
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('data-tip', 'Switch to Ink')
    expect(button).not.toHaveTextContent('Paper')
    expect(button).not.toHaveTextContent('Ink')
    expect(screen.queryByText('Paper')).not.toBeInTheDocument()
    expect(screen.queryByText('Ink')).not.toBeInTheDocument()
  })

  it('still announces the next theme after toggle', () => {
    renderToggle()

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Ink' }))

    expect(screen.getByRole('button', { name: 'Switch to Paper' })).toBeInTheDocument()
    expect(screen.queryByText('Paper')).not.toBeInTheDocument()
    expect(screen.queryByText('Ink')).not.toBeInTheDocument()
  })
})
