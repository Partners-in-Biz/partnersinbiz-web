import { parseCsv, rowsFromCsv } from '@/lib/crm/csv-import'

describe('CRM CSV import parser', () => {
  it('parses quoted CSV fields and maps shared header aliases', () => {
    const grid = parseCsv('\ufeffFull Name,E-mail,Organisation,Phone,Tags,Notes\n"Ada, Lovelace",ada@example.com,Acme,"+27 11",lead; vip,"Line ""one"""')
    const rows = rowsFromCsv(grid)

    expect(rows).toEqual([
      {
        email: 'ada@example.com',
        name: 'Ada, Lovelace',
        company: 'Acme',
        phone: '+27 11',
        tags: ['lead', 'vip'],
        notes: 'Line "one"',
      },
    ])
  })
})
