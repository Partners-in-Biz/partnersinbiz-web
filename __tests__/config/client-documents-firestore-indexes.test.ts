import indexesConfig from '@/firestore.indexes.json'

function hasIndex(collectionGroup: string, fields: Array<{ fieldPath: string; order: string }>) {
  return indexesConfig.indexes.some((index) => (
    index.collectionGroup === collectionGroup
    && index.queryScope === 'COLLECTION'
    && JSON.stringify(index.fields) === JSON.stringify(fields)
  ))
}

describe('client document Firestore indexes', () => {
  it('supports the recent access-log query', () => {
    expect(hasIndex('document_access_log', [
      { fieldPath: 'documentId', order: 'ASCENDING' },
      { fieldPath: 'accessedAt', order: 'DESCENDING' },
    ])).toBe(true)
  })

  it('supports the recent document-tasks query', () => {
    expect(hasIndex('document_tasks', [
      { fieldPath: 'documentId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ])).toBe(true)
  })
})
