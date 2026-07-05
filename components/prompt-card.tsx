'use client'

import { useState, useTransition } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import { CopyButton } from '@/components/copy-button'
import { deletePrompt } from '@/app/actions'
import type { Prompt } from '@/lib/types'

export function PromptCard({ prompt }: { prompt: Prompt }) {
  const [isDeleting, startDeleteTransition] = useTransition()
  const [isOpen, setIsOpen] = useState(false)

  function handleDelete() {
    if (!confirm('Delete this prompt?')) return
    startDeleteTransition(async () => {
      await deletePrompt(prompt.id)
    })
  }

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 transition-opacity ${
        isDeleting ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          className="-m-1 flex flex-1 items-start gap-1.5 rounded-md p-1 text-left"
        >
          <ChevronDown
            className={`mt-0.5 size-4 shrink-0 text-neutral-500 transition-transform ${
              isOpen ? '' : '-rotate-90'
            }`}
          />
          <h3 className="text-sm font-semibold text-neutral-100">{prompt.title}</h3>
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
        <div className="flex flex-col gap-3 overflow-hidden">
          {prompt.description && <p className="text-xs text-neutral-400">{prompt.description}</p>}
          <p className="whitespace-pre-wrap rounded-lg bg-neutral-950/60 p-2.5 font-mono text-xs text-neutral-300">
            {prompt.content}
          </p>
        </div>
      </div>

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
