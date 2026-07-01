function activeRows(rows) {
  return rows.filter((row) => row?.deleted !== true)
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function lower(value) {
  return text(value).toLowerCase()
}

function emailDuplicateGroups(contacts) {
  const groups = new Map()
  for (const contact of contacts) {
    const email = lower(contact.email)
    if (!email) continue
    const list = groups.get(email) ?? []
    list.push(contact)
    groups.set(email, list)
  }
  return Array.from(groups.entries())
    .filter(([, list]) => list.length > 1)
    .map(([email, list]) => ({
      email,
      count: list.length,
      ids: list.map((contact) => contact.id),
      names: list.map((contact) => contact.name || contact.displayName || '').filter(Boolean),
    }))
}

module.exports = {
  activeRows,
  emailDuplicateGroups,
}
