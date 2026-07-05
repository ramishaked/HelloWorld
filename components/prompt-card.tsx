'use client'

import { useOptimistic, useState, useTransition } from 'react'
import { ChevronDown, Image as ImageIcon, Star, Trash2, Video } from 'lucide-react'
import { CopyButton } from '@/components/copy-button'
import { deletePrompt, toggleFavorite } from '@/app/actions'
import type { Prompt } from '@/lib/types'

export function PromptCard({ prompt }: { prompt: Prompt }) {
  const [isDeleting, startDeleteTransition] = useTransition()
  const [, startFavoriteTransition] = useTransition()
  const [isOpen, setIsOpen] = useState(false)
  const [optimisticFavorite, setOptimisticFavorite] = useOptimistic(prompt.is_favorite)

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

  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 transition-opacity ${
        isDeleting ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          className="-m-1 flex flex-1 items-center gap-1.5 rounded-md p-1 text-left"
        >
          <ChevronDown
            className={`size-4 shrink-0 text-neutral-500 transition-transform ${
              isOpen ? '' : '-rotate-90'
            }`}
          />
          {prompt.media_type === 'image' && (
            <ImageIcon className="size-3.5 shrink-0 text-sky-400" aria-label="Image prompt" />
          )}
          {prompt.media_type === 'video' && (
            <Video className="size-3.5 shrink-0 text-fuchsia-400" aria-label="Video prompt" />
          )}
          <h3 className="truncate text-sm font-semibold text-neutral-100">{prompt.title}</h3>
        </button>
        <button
          type="button"
          onClick={handleToggleFavorite}
          aria-label={optimisticFavorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={optimisticFavorite}
          className="-m-1.5 shrink-0 rounded-md p-1.5 text-neutral-600 transition-colors hover:bg-amber-500/10 hover:text-amber-400 active:bg-amber-500/10 active:text-amber-400"
        >
          <Star className={`size-4 ${optimisticFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          aria-label="Delete prompt"
          className="-m-1.5 shrink-0 rounded-md p-1.5 text-neutral-600 transition-colors hover:bg-red-500/10 hover:text-red-400 active:bg-red-500/10 active:text-red-400"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="flex flex-col gap-2 overflow-hidden">
          <div className="flex flex-col gap-2 pt-1">
            {prompt.description && <p className="text-xs text-neutral-400">{prompt.description}</p>}
            <p className="whitespace-pre-wrap rounded-lg bg-neutral-950/60 p-2.5 font-mono text-xs text-neutral-300">
              {prompt.content}
            </p>
            {prompt.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {prompt.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-neutral-600">
                {new Date(prompt.created_at).toLocaleDateString()}
              </span>
              <CopyButton content={prompt.content} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
