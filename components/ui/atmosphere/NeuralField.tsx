export type NeuralFieldProps = {
  className?: string
  intensity?: number
  /** Keep Messages test id for parity when used there */
  testId?: string
}

/** @deprecated Atmosphere retired (Studio Phase 2). Returns null; deleted in Phase 4 purge. */
export function NeuralField(_props: NeuralFieldProps) {
  void _props
  return null
}

export default NeuralField
