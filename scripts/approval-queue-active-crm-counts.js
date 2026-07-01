const { activeRows } = require('./crm-gather-active-records')

function crmCountsFromRows(rows) {
  return {
    contacts: activeRows(rows.contacts ?? []).length,
    companies: activeRows(rows.companies ?? []).length,
    deals: activeRows(rows.deals ?? []).length,
  }
}

module.exports = {
  crmCountsFromRows,
}
