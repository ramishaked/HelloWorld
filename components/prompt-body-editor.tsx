'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, X } from 'lucide-react'
import { updatePrompt } from '@/app/actions'
import type { Prompt } from '@/lib/types'

export function PromptBodyEditor({ prompt, onClose }: { prompt: Prompt; onClose: () => void }) {
  const router = useRouter()
  const [isSaving, startSaving] = useTransition()
  const [content, setContent] = useState(prompt.content)
  const [description, setDescription] = useState(prompt.description ?? '')
  const [tags, setTags] = useState<string[]>(prompt.tags)
  const [tagDraft, setTagDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  function addTag() {
    const next = tagDraft.trim()
    if (next && !tags.includes(next)) setTags((t) => [...t, next])
    setTagDraft('')
  }

  function removeTag(tag: string) {
    setTags((t) => t.filter((x) => x !== tag))
  }

  function handleSave() {
    if (!content.trim()) {
      setError('Content cannot be empty.')
      return
    }
    setError(null)
    startSaving(async () => {
      const result = await updatePrompt(prompt.id, { content, description, tags })
      if ('error' in result) {
        setError(result.error)
      } else {
        router.refresh()
        onClose()
      }
    })
  }

  // 16px (text-base) on mobile prevents iOS Safari from zooming on focus.
  const fieldClass =
    'w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-base text-neutral-900 focus:border-emerald-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 sm:text-sm'

  return (
    <div className="flex flex-col gap-2 pt-1">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className={fieldClass}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">Prompt</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          className={`${fieldClass} font-mono`}
        />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">Tags</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            >
              {tag}
              <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove ${tag}`}>
                <X className="size-3" />
              </button>
            </span>
          ))}
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                addTag()
              }
            }}
            onBlur={addTag}
            placeholder="add tag"
            className="min-w-20 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-base text-neutral-900 focus:border-emerald-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 sm:text-sm"
          />
        </div>
      </div>

      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center justify-end gap-1.5 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-2 text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-neutral-950 transition-colors hover:bg-emerald-400 disabled:opacity-60"
        >
          {isSaving && <Loader2 className="size-3.5 animate-spin" />}
          Save
        </button>
      </div>
    </div>
  )
}
