'use client'

import { useOptimistic, useState, useTransition } from 'react'
import {
  Check,
  ChevronDown,
  Image as ImageIcon,
  Languages,
  Loader2,
  Pencil,
  Star,
  Trash2,
  Video,
  X,
} from 'lucide-react'
import { CopyButton } from '@/components/copy-button'
import { ShareButton } from '@/components/share-button'
import { deletePrompt, toggleFavorite, translatePrompt, updatePromptTitle } from '@/app/actions'
import type { Prompt } from '@/lib/types'

export function PromptCard({ prompt }: { prompt: Prompt }) {
  const [isDeleting, startDeleteTransition] = useTransition()
  const [, startFavoriteTransition] = useTransition()
  const [isSavingTitle, startTitleTransition] = useTransition()
  const [isTranslating, startTranslateTransition] = useTransition()
  const [isOpen, setIsOpen] = useState(false)
  const [optimisticFavorite, setOptimisticFavorite] = useOptimistic(prompt.is_favorite)

  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(prompt.title)
  const [optimisticTitle, setOptimisticTitle] = useOptimistic(prompt.title)

  const [showTranslation, setShowTranslation] = useState(false)
  const [translatedText, setTranslatedText] = useState<string | null>(null)
  const [translateError, setTranslateError] = useState<string | null>(null)

  const displayContent = showTranslation && translatedText ? translatedText : prompt.content

  function handleDelete() {
    if (!confirm('Delete this prompt?')) return
    startDeleteTransition(async () => {
      await deletePrompt(prompt.id)
    })
  }

  function handleToggleFavorite() {
    const next = !prompt.is_favorite
    startFavoriteTransition(async () => {
      setOptimisticFavorite(next)
      await toggleFavorite(prompt.id, next)
    })
  }

  function startEditingTitle() {
    setTitleDraft(prompt.title)
    setIsEditingTitle(true)
  }

  function handleSaveTitle() {
    const next = titleDraft.trim()
    if (!next || next === prompt.title) {
      setIsEditingTitle(false)
      return
    }
    setIsEditingTitle(false)
    startTitleTransition(async () => {
      setOptimisticTitle(next)
      await updatePromptTitle(prompt.id, next)
    })
  }

  function handleToggleTranslation() {
    setTranslateError(null)
    if (showTranslation) {
      setShowTranslation(false)
      return
    }
    if (translatedText) {
      setShowTranslation(true)
      return
    }
    startTranslateTransition(async () => {
      const result = await translatePrompt(prompt.content, 'English')
      if ('error' in result) {
        setTranslateError(result.error)
      } else {
        setTranslatedText(result.text)
        setShowTranslation(true)
      }
    })
  }

  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3 transition-opacity dark:border-neutral-800 dark:bg-neutral-900/60 ${
        isDeleting ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        {isEditingTitle ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              handleSaveTitle()
            }}
          >
            <input
              autoFocus
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setIsEditingTitle(false)
              }}
              className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-base font-semibold text-neutral-900 focus:border-emerald-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 sm:text-sm"
            />
            <button
              type="submit"
              aria-label="Save title"
              className="shrink-0 rounded-md p-1.5 text-emerald-600 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400"
            >
              <Check className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Cancel editing title"
              onClick={() => setIsEditingTitle(false)}
              className="shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-200 dark:text-neutral-500 dark:hover:bg-neutral-800"
            >
              <X className="size-4" />
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setIsOpen((open) => !open)}
              aria-expanded={isOpen}
              className="-m-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-md p-1 text-left"
            >
              <ChevronDown
                className={`size-4 shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${
                  isOpen ? '' : '-rotate-90'
                }`}
              />
              {prompt.media_type === 'image' && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400">
                  <ImageIcon className="size-3" />
                  Image
                </span>
              )}
              {prompt.media_type === 'video' && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-600 dark:text-fuchsia-400">
                  <Video className="size-3" />
                  Video
                </span>
              )}
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {optimisticTitle}
              </h3>
            </button>
            <button
              type="button"
              onClick={startEditingTitle}
              aria-label="Edit title"
              disabled={isSavingTitle}
              className="-m-1.5 shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-neutral-700 active:bg-neutral-200 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              {isSavingTitle ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
            </button>
            <button
              type="button"
              onClick={handleToggleFavorite}
              aria-label={optimisticFavorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={optimisticFavorite}
              className="-m-1.5 shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-amber-500/10 hover:text-amber-600 active:bg-amber-500/10 active:text-amber-600 dark:text-neutral-600 dark:hover:text-amber-400 dark:active:text-amber-400"
            >
              <Star
                className={`size-4 ${optimisticFavorite ? 'fill-amber-500 text-amber-500 dark:fill-amber-400 dark:text-amber-400' : ''}`}
              />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              aria-label="Delete prompt"
              className="-m-1.5 shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-red-500/10 hover:text-red-600 active:bg-red-500/10 active:text-red-600 dark:text-neutral-600 dark:hover:text-red-400 dark:active:text-red-400"
            >
              <Trash2 className="size-4" />
            </button>
          </>
        )}
      </div>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="flex flex-col gap-2 overflow-hidden">
          <div className="flex flex-col gap-2 pt-1">
            {prompt.description && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{prompt.description}</p>
            )}
            <p className="whitespace-pre-wrap rounded-lg bg-neutral-100 p-2.5 font-mono text-xs text-neutral-700 dark:bg-neutral-950/60 dark:text-neutral-300">
              {displayContent}
            </p>
            {translateError && (
              <p className="text-[11px] text-red-600 dark:text-red-400">{translateError}</p>
            )}
            {prompt.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {prompt.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1">
              <button
                type="button"
                onClick={handleToggleTranslation}
                disabled={isTranslating}
                className="inline-flex items-center gap-1.5 rounded-md bg-neutral-200/70 px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-300 active:bg-neutral-300 disabled:opacity-60 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:active:bg-neutral-700"
              >
                {isTranslating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Languages className="size-3.5" />
                )}
                {showTranslation ? 'Original' : 'English'}
              </button>
              <ShareButton title={optimisticTitle} content={displayContent} />
              <CopyButton content={displayContent} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
