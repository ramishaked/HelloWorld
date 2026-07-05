'use client'

import { useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import { CopyButton } from '@/components/copy-button'
import { deletePrompt } from '@/app/actions'
import type { Prompt } from '@/lib/types'

export function PromptCard({ prompt }: { prompt: Prompt }) {
  const [isDeleting, startDeleteTransition] = useTransition()

  function handleDelete() {
    if (!confirm('Delete this prompt?')) return
    startDeleteTransition(async () => {
      await deletePrompt(prompt.id)
    })
  }

  return (
    <div
      className={`group flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 transition-opacity ${
        isDeleting ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-100">{prompt.title}</h3>
        <button
          type="button"
          onClick={handleDelete}
          aria-label="Delete prompt"
          className="shrink-0 rounded-md p-1 text-neutral-500 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {prompt.description && (
        <p className="line-clamp-2 text-xs text-neutral-400">{prompt.description}</p>
      )}

      <p className="line-clamp-4 whitespace-pre-wrap rounded-lg bg-neutral-950/60 p-2.5 font-mono text-xs text-neutral-300">
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

      <div className="mt-auto flex items-center justify-between pt-1">
        <span className="text-[11px] text-neutral-600">
          {new Date(prompt.created_at).toLocaleDateString()}
        </span>
        <CopyButton content={prompt.content} />
      </div>
    </div>
  )
}
