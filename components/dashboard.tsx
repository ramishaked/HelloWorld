'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardPaste, Filter, Loader2, Search, Star, X } from 'lucide-react'
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
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [selectedTopics, setSelectedTopics] = useState<string[]>([])
  const [favoritesOnly, setFavoritesOnly] = useState(false)

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

  const allTopics = useMemo(() => {
    const tags = new Set<string>()
    for (const prompt of initialPrompts) {
      for (const tag of prompt.tags) tags.add(tag)
    }
    return Array.from(tags).sort()
  }, [initialPrompts])

  function toggleTopic(tag: string) {
    setSelectedTopics((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
    )
  }

  function clearFilters() {
    setSelectedTopics([])
    setFavoritesOnly(false)
  }

  const activeFilterCount = selectedTopics.length + (favoritesOnly ? 1 : 0)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return initialPrompts.filter((prompt) => {
      if (favoritesOnly && !prompt.is_favorite) return false
      if (selectedTopics.length > 0 && !selectedTopics.some((tag) => prompt.tags.includes(tag))) {
        return false
      }
      if (!q) return true
      const haystack = [prompt.title, prompt.description ?? '', prompt.content, ...prompt.tags]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [initialPrompts, query, selectedTopics, favoritesOnly])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-6 py-6">
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

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by keyword..."
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900/60 py-2.5 pl-10 pr-3 text-base text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none sm:text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => setIsFilterOpen((open) => !open)}
          aria-expanded={isFilterOpen}
          className={`relative inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors sm:py-2 ${
            isFilterOpen || activeFilterCount > 0
              ? 'border-emerald-600/60 bg-emerald-500/10 text-emerald-300'
              : 'border-neutral-800 bg-neutral-900/60 text-neutral-400'
          }`}
        >
          <Filter className="size-4" />
          <span className="hidden sm:inline">Filter</span>
          {activeFilterCount > 0 && (
            <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-semibold text-neutral-950">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {isFilterOpen && (
        <div className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setFavoritesOnly((v) => !v)}
              aria-pressed={favoritesOnly}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                favoritesOnly ? 'bg-amber-500/10 text-amber-400' : 'text-neutral-400 hover:bg-neutral-800'
              }`}
            >
              <Star className={`size-3.5 ${favoritesOnly ? 'fill-amber-400' : ''}`} />
              Favorites only
            </button>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300"
              >
                <X className="size-3.5" />
                Clear filters
              </button>
            )}
          </div>

          {allTopics.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allTopics.map((topic) => (
                <button
                  key={topic}
                  type="button"
                  onClick={() => toggleTopic(topic)}
                  aria-pressed={selectedTopics.includes(topic)}
                  className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                    selectedTopics.includes(topic)
                      ? 'bg-emerald-500 text-neutral-950'
                      : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                  }`}
                >
                  {topic}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-neutral-800 py-24 text-sm text-neutral-600">
          {initialPrompts.length === 0
            ? 'No prompts yet. Copy some text or a screenshot, then paste it here.'
            : 'No prompts match your search or filters.'}
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
