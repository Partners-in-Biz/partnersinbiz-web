export interface LifeOsReflectionSafetyCopy {
  disclosure: string
  consent: string
  pressure: string
}

export interface LifeOsCoachBoundaryCopy {
  role: string
  emergency: string
  scope: string
}

export const lifeOsReflectionSafetyCopy: LifeOsReflectionSafetyCopy = {
  disclosure: 'Share only what feels useful. You do not need to include medical, mental-health, crisis, legal, financial, or other highly sensitive details.',
  consent: 'We store Life OS entries only after consent and use them to support your check-ins, coaching context, dashboards, and reminders inside your workspace.',
  pressure: 'Short, practical notes are enough. Skip anything you would rather keep private or discuss with a qualified professional.',
}

export const lifeOsCoachBoundaryCopy: LifeOsCoachBoundaryCopy = {
  role: 'Life OS coaching is not therapy, medical care, crisis support, legal advice, or financial advice. It can help you reflect, prioritise, and choose small experiments from the context you provide.',
  emergency: 'If you might be in immediate danger, contact local emergency services or a trusted person now. The coach cannot monitor emergencies or provide real-time crisis response.',
  scope: 'The coach should not diagnose, prescribe, interpret symptoms, or replace a qualified professional. Keep the focus on planning, habits, reflection, and next-step support.',
}
