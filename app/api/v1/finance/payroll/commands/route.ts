import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreFinancePayrollGateway,
  type ActivateSalaryStructureCommand,
  type AddPayRunItemCommand,
  type ApplyIndividualAdjustmentCommand,
  type ApproveLockPayRunCommand,
  type ApprovePayrollRuleVersionCommand,
  type ApproveStatutoryCommand,
  type ApproveYtdOpeningCommand,
  type BuildBulkPayslipRunPackCommand,
  type BuildEmp501AnnualPackCommand,
  type BuildPayslipPackCommand,
  type CalculateEmployeePayrollCommand,
  type CloseTaxYearCommand,
  type CreateCorrectionPayRunCommand,
  type CreateEmploymentTermVersionCommand,
  type CreateLeaveTypeCommand,
  type CreatePayComponentCommand,
  type CreatePayPeriodCommand,
  type CreatePayRunCommand,
  type CreatePayrollCalendarCommand,
  type CreatePayrollEmployeeCommand,
  type CreatePayrollEmploymentCommand,
  type CreatePayrollRuleVersionCommand,
  type CreateSalaryStructureCommand,
  type CreateTaxYearCommand,
  type CreateYtdOpeningCommand,
  type DecideLeaveCommand,
  type ExpandSalaryStructureCommand,
  type FreezePayRunInputsCommand,
  type GenerateExportCommand,
  type LinkEmployeeUserCommand,
  type LockTaxYearCommand,
  type MarkBulkPayslipRunPackDownloadedCommand,
  type ObserveExternalSalaryPaymentCommand,
  type PrepareEmp201Command,
  type PrepareEmp501Command,
  type PrepareIrp5Command,
  type RequestLeaveCommand,
  type ReversePayRunCommand,
  type SetLeaveBalanceCommand,
  type SubmitPayRunCommand,
} from '@/lib/payroll/firestore-payroll-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'employee.create','employee.link-user','employment.create','term.create','component.create','rule.create','rule.approve',
  'calendar.create','period.create','calculate','pay-run.create','pay-run.add-item','pay-run.freeze','pay-run.submit',
  'pay-run.approve-lock','pay-run.reverse','pay-run.correct','pay-run.adjust','salary-payment.observe',
  'leave-type.create','leave-balance.set','leave.request','leave.decide','payslip.pack','payslip.pack.mark-downloaded',
  'salary-structure.create','salary-structure.activate','salary-structure.expand',
  'payslip.bulk-pack','payslip.bulk-pack.mark-downloaded','emp501.annual-pack',
  'tax-year.create','tax-year.close','tax-year.lock','ytd-opening.create','ytd-opening.approve','irp5.prepare','irp5.approve',
  'emp201.prepare','emp201.approve','emp501.prepare','emp501.approve','export.generate',
] as const

type PayrollOperation = typeof OPERATIONS[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreFinancePayrollGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/payroll/commands',
    execute: async (operation, actor, command) => {
      switch (operation as PayrollOperation) {
        case 'employee.create': return gateway.createEmployee(actor, command as unknown as CreatePayrollEmployeeCommand)
        case 'employee.link-user': return gateway.linkEmployeeUser(actor, command as unknown as LinkEmployeeUserCommand)
        case 'employment.create': return gateway.createEmployment(actor, command as unknown as CreatePayrollEmploymentCommand)
        case 'term.create': return gateway.createTermVersion(actor, command as unknown as CreateEmploymentTermVersionCommand)
        case 'component.create': return gateway.createPayComponent(actor, command as unknown as CreatePayComponentCommand)
        case 'rule.create': return gateway.createRuleVersion(actor, command as unknown as CreatePayrollRuleVersionCommand)
        case 'rule.approve': return gateway.approveRuleVersion(actor, command as unknown as ApprovePayrollRuleVersionCommand)
        case 'calendar.create': return gateway.createCalendar(actor, command as unknown as CreatePayrollCalendarCommand)
        case 'period.create': return gateway.createPayPeriod(actor, command as unknown as CreatePayPeriodCommand)
        case 'calculate': return gateway.calculateEmployee(actor, command as unknown as CalculateEmployeePayrollCommand)
        case 'pay-run.create': return gateway.createPayRun(actor, command as unknown as CreatePayRunCommand)
        case 'pay-run.add-item': return gateway.addPayRunItem(actor, command as unknown as AddPayRunItemCommand)
        case 'pay-run.freeze': return gateway.freezePayRunInputs(actor, command as unknown as FreezePayRunInputsCommand)
        case 'pay-run.submit': return gateway.submitPayRun(actor, command as unknown as SubmitPayRunCommand)
        case 'pay-run.approve-lock': return gateway.approveLockPayRun(actor, command as unknown as ApproveLockPayRunCommand)
        case 'pay-run.reverse': return gateway.reversePayRun(actor, command as unknown as ReversePayRunCommand)
        case 'pay-run.correct': return gateway.createCorrectionRun(actor, command as unknown as CreateCorrectionPayRunCommand)
        case 'pay-run.adjust': return gateway.applyIndividualAdjustment(actor, command as unknown as ApplyIndividualAdjustmentCommand)
        case 'salary-payment.observe': return gateway.observeExternalSalaryPayment(actor, command as unknown as ObserveExternalSalaryPaymentCommand)
        case 'leave-type.create': return gateway.createLeaveType(actor, command as unknown as CreateLeaveTypeCommand)
        case 'leave-balance.set': return gateway.setLeaveBalance(actor, command as unknown as SetLeaveBalanceCommand)
        case 'leave.request': return gateway.requestLeave(actor, command as unknown as RequestLeaveCommand)
        case 'leave.decide': return gateway.decideLeave(actor, command as unknown as DecideLeaveCommand)
        case 'payslip.pack': return gateway.buildPayslipPack(actor, command as unknown as BuildPayslipPackCommand)
        case 'payslip.pack.mark-downloaded': return gateway.markPayslipPackDownloaded(actor, command as any)
        case 'salary-structure.create': return gateway.createSalaryStructure(actor, command as unknown as CreateSalaryStructureCommand)
        case 'salary-structure.activate': return gateway.activateSalaryStructure(actor, command as unknown as ActivateSalaryStructureCommand)
        case 'salary-structure.expand': return gateway.expandSalaryStructure(actor, command as unknown as ExpandSalaryStructureCommand)
        case 'payslip.bulk-pack': return gateway.buildBulkPayslipRunPack(actor, command as unknown as BuildBulkPayslipRunPackCommand)
        case 'payslip.bulk-pack.mark-downloaded': return gateway.markBulkPayslipRunPackDownloaded(actor, command as unknown as MarkBulkPayslipRunPackDownloadedCommand)
        case 'emp501.annual-pack': return gateway.buildEmp501AnnualPack(actor, command as unknown as BuildEmp501AnnualPackCommand)
        case 'tax-year.create': return gateway.createTaxYear(actor, command as unknown as CreateTaxYearCommand)
        case 'tax-year.close': return gateway.closeTaxYear(actor, command as unknown as CloseTaxYearCommand)
        case 'tax-year.lock': return gateway.lockTaxYear(actor, command as unknown as LockTaxYearCommand)
        case 'ytd-opening.create': return gateway.createYtdOpening(actor, command as unknown as CreateYtdOpeningCommand)
        case 'ytd-opening.approve': return gateway.approveYtdOpening(actor, command as unknown as ApproveYtdOpeningCommand)
        case 'irp5.prepare': return gateway.prepareIrp5(actor, command as unknown as PrepareIrp5Command)
        case 'irp5.approve': return gateway.approveIrp5(actor, command as unknown as ApproveStatutoryCommand)
        case 'emp201.prepare': return gateway.prepareEmp201(actor, command as unknown as PrepareEmp201Command)
        case 'emp201.approve': return gateway.approveEmp201(actor, command as unknown as ApproveStatutoryCommand)
        case 'emp501.prepare': return gateway.prepareEmp501(actor, command as unknown as PrepareEmp501Command)
        case 'emp501.approve': return gateway.approveEmp501(actor, command as unknown as ApproveStatutoryCommand)
        case 'export.generate': return gateway.generateExportManifest(actor, command as unknown as GenerateExportCommand)
      }
    },
  })
})
