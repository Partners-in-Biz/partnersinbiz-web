import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import LoginPage from '@/app/(auth)/login/page'

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={props.alt ?? ''} {...props} />
  },
}))

jest.mock('@/lib/firebase/auth', () => ({
  loginWithEmail: jest.fn(),
  resetPassword: jest.fn(),
}))

jest.mock('@/lib/pwa/lastPath', () => ({
  readLastPath: jest.fn(),
}))

jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ error: jest.fn() }),
}))

jest.mock('@/lib/notifications/welcomeFlash', () => ({
  setWelcomeFlash: jest.fn(),
}))

it('uses POST semantics for login so password fields never fall back to URL query submission', () => {
  const { container } = render(<LoginPage />)

  expect(screen.getByText('Welcome back.')).toBeInTheDocument()
  const email = container.querySelector('input[name="email"]')
  expect(email).toBeTruthy()
  const form = email!.closest('form')

  expect(form).toHaveAttribute('method', 'post')
  expect(form).toHaveAttribute('action', '/login')
})
