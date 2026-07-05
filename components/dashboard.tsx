'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardPaste, Loader2, Search } from 'lucide-react'
import { createPromptFromImage, createPromptFromText } from '@/app/actions'
import { PromptCard } from '@/components/prompt-card'
import type { Prompt } from '@/lib/types'

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string }

// We only need enough resolution for Gemini to OCR text out of the image, not
// the original photo quality, so downscale before upload. This keeps every
// paste well under any request-size limit (Next.js's Server Action limit,
// and Vercel's own platform ceiling for function payloads) regardless of how
// large the source photo/screenshot was.
const MAX_IMAGE_DIMENSION = 2000
const IMAGE_QUALITY = 0.9
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

async function downscaleImage(file: File): Promise<File> {
  if (typeof createImageBitmap === 'undefined') return file

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', IMAGE_QUALITY)
  )
  if (!blob) return file

  return new File([blob], 'pasted.jpg', { type: 'image/jpeg' })
}

export function Dashboard({ initialPrompts }: { initialPrompts: Prompt[] }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [isPending, startTransition] = useTransition()

  const saveImage = useCallback(
    (file: File) => {
      setStatus({ kind: 'saving' })
      startTransition(async () => {
        try {
          const optimized = await downscaleImage(file)
          if (optimized.size > MAX_UPLOAD_BYTES) {
            setStatus({ kind: 'error', message: 'That image is too large even after compression.' })
            return
          }

          const formData = new FormData()
          formData.set('image', optimized)
          const result = await createPromptFromImage(formData)
          if ('error' in result) {
            setStatus({ kind: 'error', message: result.error })
          } else {
            setStatus({ kind: 'idle' })
            router.refresh()
          }
        } catch {
          setStatus({ kind: 'error', message: 'Failed to save the image. Please try again.' })
        }
      })
    },
    [router]
  )

  const saveText = useCallback(
    (text: string) => {
      setStatus({ kind: 'saving' })
      startTransition(async () => {
        try {
          const result = await createPromptFromText(text)
          if ('error' in result) {
            setStatus({ kind: 'error', message: result.error })
          } else {
            setStatus({ kind: 'idle' })
            router.refresh()
          }
        } catch {
          setStatus({ kind: 'error', message: 'Failed to save the prompt. Please try again.' })
        }
      })
    },
    [router]
  )

  // Desktop convenience: Cmd/Ctrl+V anywhere on the page. iPhone has no such
  // shortcut, so this is a bonus path, not the primary one (see handlePasteTap below).
  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return

      const items = event.clipboardData?.items
      if (!items) return

      const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'))
      if (imageItem) {
        const file = imageItem.getAsFile()
        if (!file) return
        event.preventDefault()
        saveImage(file)
        return
      }

      const text = event.clipboardData?.getData('text/plain')
      if (text && text.trim()) {
        event.preventDefault()
        saveText(text)
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [saveImage, saveText])

  // Primary path on iPhone (and a one-tap option everywhere): read the
  // clipboard directly via the Async Clipboard API from a tap gesture,
  // since there's no keyboard shortcut to listen for on a touch device.
  async function handlePasteTap() {
    if (!navigator.clipboard) {
      setStatus({ kind: 'error', message: 'Clipboard access is not available in this browser.' })
      return
    }

    try {
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read()
        for (const item of items) {
          const imageType = item.types.find((type) => type.startsWith('image/'))
          if (imageType) {
            const blob = await item.getType(imageType)
            const extension = imageType.split('/')[1] || 'png'
            saveImage(new File([blob], `pasted.${extension}`, { type: imageType }))
            return
          }
        }
      }

      const text = await navigator.clipboard.readText()
      if (text.trim()) {
        saveText(text)
      } else {
        setStatus({ kind: 'error', message: 'Clipboard is empty.' })
      }
    } catch {
      setStatus({
        kind: 'error',
        message: 'Could not read the clipboard. Allow clipboard access and try again.',
      })
    }
  }

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
          Tap Paste below, or press{' '}
          <kbd className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">Cmd/Ctrl+V</kbd>{' '}
          on desktop, to save whatever&rsquo;s on your clipboard.
        </p>
      </header>

      <div
        className={`flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm transition-colors ${
          isPending
            ? 'border-emerald-600/60 bg-emerald-500/5 text-emerald-300'
            : status.kind === 'error'
              ? 'border-red-600/60 bg-red-500/5 text-red-300'
              : 'border-neutral-800 text-neutral-500'
        }`}
      >
        <button
          type="button"
          onClick={handlePasteTap}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-neutral-950 transition-colors hover:bg-emerald-400 active:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <ClipboardPaste className="size-4" />}
          {isPending ? 'Saving...' : 'Paste'}
        </button>
        <span>
          {isPending
            ? 'Analyzing and saving your prompt...'
            : status.kind === 'error'
              ? status.message
              : 'Text or a screenshot — Gemini reads and tags it automatically.'}
        </span>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search prompts by title, tag, or content..."
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900/60 py-2.5 pl-10 pr-3 text-base text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none sm:text-sm"
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
