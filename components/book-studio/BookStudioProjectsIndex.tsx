'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { EmptyState, Surface } from '@/components/ui/AppFoundation'
import { getBookFormat } from '@/lib/book-studio/format-registry'
import { listBookStudioRecords } from '@/lib/book-studio/client'
import { NewBookDialog } from './NewBookDialog'
import type { BookProject } from './project/types'

type BookStudioProjectsIndexProps = {
  orgId: string
  orgSlug: string
}

export function BookStudioProjectsIndex({ orgId, orgSlug }: BookStudioProjectsIndexProps) {
  const router = useRouter()
  const [projects, setProjects] = useState<BookProject[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await listBookStudioRecords<BookProject>('projects', orgId)
    if (result.ok) {
      setProjects(result.data.records ?? [])
      setNotice('')
    } else {
      setNotice(result.error)
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm text-[var(--color-pib-text)]">Book projects</h2>
        <button type="button" className="btn-pib-primary btn-pib-sm font-label" onClick={() => setDialogOpen(true)}>
          New book
        </button>
      </div>

      {notice ? (
        <Surface role="alert" className="border-red-200 bg-red-50 text-red-900">
          <p>{notice}</p>
        </Surface>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading book projects…</p>
      ) : projects.length === 0 ? (
        <EmptyState
          icon="auto_stories"
          title="No books yet"
          description="Create your first book — pick a format, optionally start from a template, and begin writing."
          action={
            <button type="button" className="btn-pib-primary btn-pib-sm font-label" onClick={() => setDialogOpen(true)}>
              New book
            </button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const format = project.format ? getBookFormat(project.format) : null
            return (
              <Link
                key={project.id}
                href={`/admin/org/${orgSlug}/book-studio/${project.id}`}
                className="pib-card block p-3 transition-colors hover:border-rose-400/40"
              >
                {project.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={project.coverImageUrl}
                    alt=""
                    className="mb-3 h-32 w-full rounded-lg object-cover"
                  />
                ) : null}
                <strong className="text-sm text-[var(--color-pib-text)]">{project.title ?? 'Untitled book'}</strong>
                <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                  {format?.label ?? project.format ?? 'No format'}
                  {project.stage ? ` · ${project.stage.replace(/_/g, ' ')}` : ''}
                </p>
              </Link>
            )
          })}
        </div>
      )}

      <NewBookDialog
        orgId={orgId}
        surface="admin"
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(projectId) => {
          setDialogOpen(false)
          router.push(`/admin/org/${orgSlug}/book-studio/${projectId}`)
        }}
      />
    </div>
  )
}
