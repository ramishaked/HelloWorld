'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileJson, FileText, Loader2, MoreVertical, Sparkles, Upload } from 'lucide-react'
import { importPrompts, type ImportRow } from '@/app/actions'
import { exportPromptsAsJson, exportPromptsAsMarkdown } from '@/lib/prompt-export'
import type { Prompt } from '@/lib/types'

export function ExportImportMenu({
  prompts,
  onReorganize,
  reorganizeRunning,
}: {
  prompts: Prompt[]
  onReorganize: () => void
  reorganizeRunning: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isImporting, startImport] = useTransition()
  const [note, setNote] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setNote(null)
    const reader = new FileReader()
    reader.onload = () => {
      let rows: ImportRow[]
      try {
        const parsed = JSON.parse(String(reader.result))
        rows = Array.isArray(parsed) ? parsed : []
      } catch {
        setNote('That file is not valid JSON.')
        return
      }
      startImport(async () => {
        const result = await importPrompts(rows)
        if ('error' in result) {
          setNote(result.error)
        } else {
          setNote(`Imported ${result.imported}, skipped ${result.skipped}.`)
          router.refresh()
        }
      })
    }
    reader.readAsText(file)
  }

  const itemClass =
    'flex w-full items-center gap-2 px-3 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Backup and import"
        aria-expanded={open}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 transition-colors hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        {isImporting ? <Loader2 className="size-4 animate-spin" /> : <MoreVertical className="size-4" />}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-1 w-52 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              exportPromptsAsJson(prompts)
              setOpen(false)
            }}
          >
            <FileJson className="size-4" />
            Export as JSON
          </button>
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              exportPromptsAsMarkdown(prompts)
              setOpen(false)
            }}
          >
            <FileText className="size-4" />
            Export as Markdown
          </button>
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              fileRef.current?.click()
              setOpen(false)
            }}
          >
            <Upload className="size-4" />
            Import from JSON
          </button>

          <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />

          <button
            type="button"
            disabled={reorganizeRunning || prompts.length === 0}
            className={`${itemClass} disabled:opacity-50`}
            onClick={() => {
              setOpen(false)
              onReorganize()
            }}
          >
            <Sparkles className="size-4" />
            Reorganize subjects
          </button>

          <div className="flex items-center gap-2 px-3 pt-1 text-[11px] text-neutral-400 dark:text-neutral-600">
            <Download className="size-3" />
            {prompts.length} saved
          </div>
        </div>
      )}

      {note && (
        <span className="absolute right-0 top-full mt-1 whitespace-nowrap text-[11px] text-neutral-500 dark:text-neutral-400">
          {note}
        </span>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportFile}
      />
    </div>
  )
}
