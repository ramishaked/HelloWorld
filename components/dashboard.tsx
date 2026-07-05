'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardPaste, Loader2, Search } from 'lucide-react'
import { createPromptFromImage, createPromptFromText } from '@/app/actions'
import { PromptCard } from '@/components/prompt-card'
import type { Prompt } from '@/lib/types'

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string }

export function Dashboard({ initialPrompts }: { initialPrompts: Prompt[] }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return

      const items = event.clipboardData?.items
      if (!items) return

      const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'))

      if (imageItem) {
        event.preventDefault()
        const file = imageItem.getAsFile()
        if (!file) return
        setStatus({ kind: 'saving' })
        const formData = new FormData()
        formData.set('image', file)
        startTransition(async () => {
          const result = await createPromptFromImage(formData)
          if ('error' in result) {
            setStatus({ kind: 'error', message: result.error })
          } else {
            setStatus({ kind: 'idle' })
            router.refresh()
          }
        })
        return
      }

      const text = event.clipboardData?.getData('text/plain')
      if (text && text.trim()) {
        event.preventDefault()
        setStatus({ kind: 'saving' })
        startTransition(async () => {
          const result = await createPromptFromText(text)
          if ('error' in result) {
            setStatus({ kind: 'error', message: result.error })
          } else {
            setStatus({ kind: 'idle' })
            router.refresh()
          }
        })
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [router])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return initialPrompts
    return initialPrompts.filter((prompt) => {
      const haystack = [prompt.title, prompt.description ?? '', prompt.content, ...prompt.tags]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [initialPrompts, query])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">PromptVault</h1>
        <p className="text-sm text-neutral-500">
          Press <kbd className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">Cmd/Ctrl+V</kbd>{' '}
          anywhere on this page to save a prompt from your clipboard.
        </p>
      </header>

      <div
        className={`flex items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm transition-colors ${
          isPending
            ? 'border-emerald-600/60 bg-emerald-500/5 text-emerald-300'
            : status.kind === 'error'
              ? 'border-red-600/60 bg-red-500/5 text-red-300'
              : 'border-neutral-800 text-neutral-500'
        }`}
      >
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Analyzing and saving your prompt...
          </>
        ) : status.kind === 'error' ? (
          <>{status.message}</>
        ) : (
          <>
            <ClipboardPaste className="size-4" />
            Waiting for a paste (text or screenshot).
          </>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search prompts by title, tag, or content..."
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900/60 py-2 pl-10 pr-3 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-neutral-800 py-24 text-sm text-neutral-600">
          {initialPrompts.length === 0
            ? 'No prompts yet. Copy some text or a screenshot, then paste it here.'
            : 'No prompts match your search.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((prompt) => (
            <PromptCard key={prompt.id} prompt={prompt} />
          ))}
        </div>
      )}
    </div>
  )
}
