// lib/products/store.ts
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { Product, ProductInput } from './types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

const PRODUCTS = 'products'

export async function listProducts(orgId: string): Promise<Product[]> {
  const snap = await adminDb
    .collection(PRODUCTS)
    .where('orgId', '==', orgId)
    .where('deleted', '!=', true)
    .orderBy('name', 'asc')
    .get()
  return snap.docs.map((d) => ({ ...(d.data() as Omit<Product, 'id'>), id: d.id }))
}

export async function getProduct(orgId: string, productId: string): Promise<Product | null> {
  const snap = await adminDb.collection(PRODUCTS).doc(productId).get()
  if (!snap.exists) return null
  const data = snap.data() as Product
  if (data.orgId !== orgId) return null
  return { ...data, id: snap.id }
}

export async function createProduct(
  orgId: string,
  input: ProductInput,
  actor: MemberRef,
): Promise<Product> {
  const ref = await adminDb.collection(PRODUCTS).add({
    ...input,
    orgId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdByRef: actor,
    updatedByRef: actor,
  })
  const snap = await ref.get()
  return { ...snap.data(), id: ref.id } as Product
}

export async function updateProduct(
  orgId: string,
  productId: string,
  patch: Partial<ProductInput>,
  actor: MemberRef,
): Promise<Product> {
  const ref = adminDb.collection(PRODUCTS).doc(productId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error(`Product not found: ${productId}`)
  const existing = snap.data() as Product
  if (existing.orgId !== orgId) throw new Error(`Product not found: ${productId}`)
  await ref.update({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByRef: actor,
  })
  const updated = await ref.get()
  return { ...updated.data(), id: ref.id } as Product
}

export async function deleteProduct(
  orgId: string,
  productId: string,
  actor: MemberRef,
): Promise<void> {
  const ref = adminDb.collection(PRODUCTS).doc(productId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error(`Product not found: ${productId}`)
  const existing = snap.data() as Product
  if (existing.orgId !== orgId) throw new Error(`Product not found: ${productId}`)
  await ref.update({
    deleted: true,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByRef: actor,
  })
}
