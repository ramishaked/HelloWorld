'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ClipboardPaste,
  Filter,
  Image as ImageIcon,
  Layers,
  Loader2,
  Search,
  Sparkles,
  Star,
  Video,
  X,
} from 'lucide-react'
import { createPromptFromImage, createPromptFromText, reanalyzePrompt } from '@/app/actions'
import { PromptCard } from '@/components/prompt-card'
import { ThemeToggle } from '@/components/theme-toggle'
import { ExportImportMenu } from '@/components/export-import-menu'
import type { MediaType } from '@/lib/gemini'
import type { Prompt } from '@/lib/types'

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }
  | { kind: 'info'; message: string }

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
  const [isSubjectsOpen, setIsSubjectsOpen] = useState(false)
  const [selectedTopics, setSelectedTopics] = useState<string[]>([])
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [selectedMediaTypes, setSelectedMediaTypes] = useState<MediaType[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [bulk, setBulk] = useState<{
    done: number
    total: number
    errors: number
    running: boolean
  } | null>(null)
  const cancelBulkRef = useRef(false)

  async function handleReanalyzeAll() {
    const targets = initialPrompts
    if (targets.length === 0 || bulk?.running) return
    if (
      !confirm(
        `Re-analyze all ${targets.length} prompts? This runs the AI on each one and may take a while.`
      )
    ) {
      return
    }

    cancelBulkRef.current = false
    let done = 0
    let errors = 0
    setBulk({ done, total: targets.length, errors, running: true })

    try {
      for (const prompt of targets) {
        if (cancelBulkRef.current) break
        try {
          // Race each call against a timeout so one hung/slow request can't
          // wedge the whole run — count it as a failure and move on.
          const result = await Promise.race([
            reanalyzePrompt(prompt.id, false),
            new Promise<{ error: string }>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), 45000)
            ),
          ])
          if ('error' in result) errors++
        } catch {
          // Rejected (network error, function timeout, or our 45s cap): count
          // and keep going rather than freezing the progress bar.
          errors++
        }
        done++
        setBulk({ done, total: targets.length, errors, running: true })
      }
    } finally {
      // Always leave the bar in a finished state, even if something unexpected
      // throws — the spinner can never stick.
      router.refresh()
      setBulk({ done, total: targets.length, errors, running: false })
      setTimeout(() => setBulk(null), 5000)
    }
  }

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
          } else if ('duplicate' in result) {
            setStatus({ kind: 'info', message: 'Already saved — skipped duplicate.' })
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
          } else if ('duplicate' in result) {
            setStatus({ kind: 'info', message: 'Already saved — skipped duplicate.' })
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

  // Subject clusters: group by the AI-assigned category, counts sorted desc.
  const clusters = useMemo(() => {
    const counts = new Map<string, number>()
    for (const prompt of initialPrompts) {
      if (prompt.category) counts.set(prompt.category, (counts.get(prompt.category) ?? 0) + 1)
    }
    return Array.from(counts, ([name, count]) => ({ name, count })).sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name)
    )
  }, [initialPrompts])

  function toggleTopic(tag: string) {
    setSelectedTopics((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
    )
  }

  function toggleMediaType(mediaType: MediaType) {
    setSelectedMediaTypes((current) =>
      current.includes(mediaType) ? current.filter((t) => t !== mediaType) : [...current, mediaType]
    )
  }

  function toggleCategory(name: string) {
    setSelectedCategory((current) => (current === name ? null : name))
  }

  function clearFilters() {
    setSelectedTopics([])
    setFavoritesOnly(false)
    setSelectedMediaTypes([])
    setSelectedCategory(null)
  }

  const activeFilterCount =
    selectedTopics.length + selectedMediaTypes.length + (favoritesOnly ? 1 : 0)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return initialPrompts.filter((prompt) => {
      if (selectedCategory && prompt.category !== selectedCategory) return false
      if (favoritesOnly && !prompt.is_favorite) return false
      if (selectedMediaTypes.length > 0 && !selectedMediaTypes.includes(prompt.media_type)) {
        return false
      }
      if (selectedTopics.length > 0 && !selectedTopics.some((tag) => prompt.tags.includes(tag))) {
        return false
      }
      if (!q) return true
      const haystack = [prompt.title, prompt.description ?? '', prompt.content, ...prompt.tags]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [initialPrompts, query, selectedTopics, favoritesOnly, selectedMediaTypes, selectedCategory])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 px-6 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handlePasteTap}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-neutral-950 transition-colors hover:bg-emerald-400 active:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <ClipboardPaste className="size-4" />}
            {isPending ? 'Saving...' : 'Paste'}
          </button>
          {status.kind === 'error' && (
            <span className="text-sm text-red-600 dark:text-red-400">{status.message}</span>
          )}
          {status.kind === 'info' && (
            <span className="text-sm text-neutral-500 dark:text-neutral-400">{status.message}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ExportImportMenu
            prompts={initialPrompts}
            onReanalyzeAll={handleReanalyzeAll}
            reanalyzeRunning={bulk?.running ?? false}
          />
          <ThemeToggle />
        </div>
      </div>

      {bulk && (
        <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-900/60">
          {bulk.running ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Sparkles className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          )}
          <div className="flex-1">
            <div className="mb-1 flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-300">
              <span>
                {bulk.running ? 'Re-analyzing' : 'Re-analyzed'} {bulk.done}/{bulk.total}
                {bulk.errors > 0 && (
                  <span className="text-red-600 dark:text-red-400"> · {bulk.errors} failed</span>
                )}
              </span>
              {bulk.running && (
                <button
                  type="button"
                  onClick={() => {
                    cancelBulkRef.current = true
                  }}
                  className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-100"
                >
                  Cancel
                </button>
              )}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-200"
                style={{ width: `${Math.round((bulk.done / bulk.total) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400 dark:text-neutral-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by keyword..."
            className="w-full rounded-lg border border-neutral-200 bg-neutral-50 py-2.5 pl-10 pr-3 text-base text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-100 dark:placeholder:text-neutral-600 dark:focus:border-neutral-600 sm:text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => setIsSubjectsOpen((open) => !open)}
          aria-expanded={isSubjectsOpen}
          className={`relative inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors sm:py-2 ${
            isSubjectsOpen || selectedCategory
              ? 'border-emerald-600/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400'
          }`}
        >
          <Layers className="size-4" />
          <span className="hidden sm:inline">Subjects</span>
          {selectedCategory && (
            <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-semibold text-neutral-950">
              1
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setIsFilterOpen((open) => !open)}
          aria-expanded={isFilterOpen}
          className={`relative inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors sm:py-2 ${
            isFilterOpen || activeFilterCount > 0
              ? 'border-emerald-600/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400'
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

      {isSubjectsOpen && (
        <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/60">
          {clusters.length === 0 ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Subjects appear as prompts are analyzed. Run{' '}
              <span className="font-medium text-neutral-700 dark:text-neutral-200">Re-analyze all</span>{' '}
              from the ⋯ menu to categorize existing prompts.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {clusters.map((cluster) => (
                <button
                  key={cluster.name}
                  type="button"
                  onClick={() => toggleCategory(cluster.name)}
                  aria-pressed={selectedCategory === cluster.name}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors ${
                    selectedCategory === cluster.name
                      ? 'bg-emerald-500 text-neutral-950'
                      : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
                  }`}
                >
                  {cluster.name}
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-semibold ${
                      selectedCategory === cluster.name
                        ? 'bg-neutral-950/15 text-neutral-950'
                        : 'bg-neutral-300 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    {cluster.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isFilterOpen && (
        <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFavoritesOnly((v) => !v)}
                aria-pressed={favoritesOnly}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  favoritesOnly
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
                }`}
              >
                <Star className={`size-3.5 ${favoritesOnly ? 'fill-amber-500 dark:fill-amber-400' : ''}`} />
                Favorites
              </button>
              <button
                type="button"
                onClick={() => toggleMediaType('image')}
                aria-pressed={selectedMediaTypes.includes('image')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  selectedMediaTypes.includes('image')
                    ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                    : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
                }`}
              >
                <ImageIcon className="size-3.5" />
                Image
              </button>
              <button
                type="button"
                onClick={() => toggleMediaType('video')}
                aria-pressed={selectedMediaTypes.includes('video')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  selectedMediaTypes.includes('video')
                    ? 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400'
                    : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
                }`}
              >
                <Video className="size-3.5" />
                Video
              </button>
            </div>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300"
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
                      : 'bg-neutral-200 text-neutral-600 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
                  }`}
                >
                  {topic}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isPending || filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {isPending && (
            <div className="flex animate-pulse flex-col gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/60">
              <div className="h-4 w-2/3 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="mt-1 flex gap-1.5">
                <div className="h-3 w-12 rounded-full bg-neutral-200 dark:bg-neutral-800" />
                <div className="h-3 w-10 rounded-full bg-neutral-200 dark:bg-neutral-800" />
              </div>
            </div>
          )}
          {filtered.map((prompt) => (
            <PromptCard key={prompt.id} prompt={prompt} />
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-neutral-200 py-24 text-sm text-neutral-400 dark:border-neutral-800 dark:text-neutral-600">
          {initialPrompts.length === 0
            ? 'No prompts yet. Copy some text or a screenshot, then paste it here.'
            : 'No prompts match your search or filters.'}
        </div>
      )}
    </div>
  )
}
