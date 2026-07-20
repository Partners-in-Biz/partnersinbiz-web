'use client'

import { NeuralField } from '@/components/ui/atmosphere/NeuralField'

/** Messages-facing NeuralField with legacy test id. */
export function MessagesNeuralField({ className = '' }: { className?: string }) {
  return <NeuralField className={className} testId="messages-neural-field" />
}

export default MessagesNeuralField
