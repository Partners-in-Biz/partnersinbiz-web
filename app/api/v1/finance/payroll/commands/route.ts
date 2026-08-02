import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreFinancePayrollGateway,
  type AddPayRunItemCommand,
  type ApplyIndividualAdjustmentCommand,
  type ApproveLockPayRunCommand,
  type ApprovePayrollRuleVersionCommand,
  type ApproveStatutoryCommand,
  type ApproveYtdOpeningCommand,
  type CalculateEmployeePayrollCommand,
  type CloseTaxYearCommand,
  type CreateCorrectionPayRunCommand,
  type CreateEmploymentTermVersionCommand,
  type CreatePayComponentCommand,
  type CreatePayPeriodCommand,
  type CreatePayRunCommand,
  type CreatePayrollCalendarCommand,
  type CreatePayrollEmployeeCommand,
  type CreatePayrollEmploymentCommand,
  type CreatePayrollRuleVersionCommand,
  type CreateTaxYearCommand,
  type CreateYtdOpeningCommand,
  type FreezePayRunInputsCommand,
  type GenerateExportCommand,
  type LockTaxYearCommand,
  type ObserveExternalSalaryPaymentCommand,
  type PrepareEmp201Command,
  type PrepareEmp501Command,
  type PrepareIrp5Command,
  type ReversePayRunCommand,
  type SubmitPayRunCommand,
} from '@/lib/payroll/firestore-payroll-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'employee.create',
  'employment.create',
  'term.create',
  'component.create',
  'rule.create',
  'rule.approve',
  'calendar.create',
  'period.create',
  'calculate',
  'pay-run.create',
  'pay-run.add-item',
  'pay-run.freeze',
  'pay-run.submit',
  'pay-run.approve-lock',
  'pay-run.reverse',
  'pay-run.correct',
  'pay-run.adjust',
  'salary-payment.observe',
  'tax-year.create',
  'tax-year.close',
  'tax-year.lock',
  'ytd-opening.create',
  'ytd-opening.approve',
  'irp5.prepare',
  'irp5.approve',
  'emp201.prepare',
  'emp201.approve',
  'emp501.prepare',
  'emp501.approve',
  'export.generate',
] as const

type PayrollOperation = typeof OPERATIONS[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreFinancePayrollGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/payroll/commands',
    execute: async (operation, actor, command) => {
      switch (operation as PayrollOperation) {
        case 'employee.create':
          return gateway.createEmployee(actor, command as unknown as CreatePayrollEmployeeCommand)
        case 'employment.create':
          return gateway.createEmployment(actor, command as unknown as CreatePayrollEmploymentCommand)
        case 'term.create':
          return gateway.createTermVersion(actor, command as unknown as CreateEmploymentTermVersionCommand)
        case 'component.create':
          return gateway.createPayComponent(actor, command as unknown as CreatePayComponentCommand)
        case 'rule.create':
          return gateway.createRuleVersion(actor, command as unknown as CreatePayrollRuleVersionCommand)
        case 'rule.approve':
          return gateway.approveRuleVersion(actor, command as unknown as ApprovePayrollRuleVersionCommand)
        case 'calendar.create':
          return gateway.createCalendar(actor, command as unknown as CreatePayrollCalendarCommand)
        case 'period.create':
          return gateway.createPayPeriod(actor, command as unknown as CreatePayPeriodCommand)
        case 'calculate':
          return gateway.calculateEmployee(actor, command as unknown as CalculateEmployeePayrollCommand)
        case 'pay-run.create':
          return gateway.createPayRun(actor, command as unknown as CreatePayRunCommand)
        case 'pay-run.add-item':
          return gateway.addPayRunItem(actor, command as unknown as AddPayRunItemCommand)
        case 'pay-run.freeze':
          return gateway.freezePayRunInputs(actor, command as unknown as FreezePayRunInputsCommand)
        case 'pay-run.submit':
          return gateway.submitPayRun(actor, command as unknown as SubmitPayRunCommand)
        case 'pay-run.approve-lock':
          return gateway.approveLockPayRun(actor, command as unknown as ApproveLockPayRunCommand)
        case 'pay-run.reverse':
          return gateway.reversePayRun(actor, command as unknown as ReversePayRunCommand)
        case 'pay-run.correct':
          return gateway.createCorrectionRun(actor, command as unknown as CreateCorrectionPayRunCommand)
        case 'pay-run.adjust':
          return gateway.applyIndividualAdjustment(actor, command as unknown as ApplyIndividualAdjustmentCommand)
        case 'salary-payment.observe':
          return gateway.observeExternalSalaryPayment(actor, command as unknown as ObserveExternalSalaryPaymentCommand)
        case 'tax-year.create':
          return gateway.createTaxYear(actor, command as unknown as CreateTaxYearCommand)
        case 'tax-year.close':
          return gateway.closeTaxYear(actor, command as unknown as CloseTaxYearCommand)
        case 'tax-year.lock':
          return gateway.lockTaxYear(actor, command as unknown as LockTaxYearCommand)
        case 'ytd-opening.create':
          return gateway.createYtdOpening(actor, command as unknown as CreateYtdOpeningCommand)
        case 'ytd-opening.approve':
          return gateway.approveYtdOpening(actor, command as unknown as ApproveYtdOpeningCommand)
        case 'irp5.prepare':
          return gateway.prepareIrp5(actor, command as unknown as PrepareIrp5Command)
        case 'irp5.approve':
          return gateway.approveIrp5(actor, command as unknown as ApproveStatutoryCommand)
        case 'emp201.prepare':
          return gateway.prepareEmp201(actor, command as unknown as PrepareEmp201Command)
        case 'emp201.approve':
          return gateway.approveEmp201(actor, command as unknown as ApproveStatutoryCommand)
        case 'emp501.prepare':
          return gateway.prepareEmp501(actor, command as unknown as PrepareEmp501Command)
        case 'emp501.approve':
          return gateway.approveEmp501(actor, command as unknown as ApproveStatutoryCommand)
        case 'export.generate':
          return gateway.generateExportManifest(actor, command as unknown as GenerateExportCommand)
      }
    },
  })
})
