'use client'

import { Share2 } from 'lucide-react'

export function ShareButton({ title, content }: { title: string; content: string }) {
  async function handleShare() {
    const text = `${title}\n\n${content}`

    // Prefer the native share sheet (iOS/Android/most mobile browsers) — it
    // exposes WhatsApp, Messages, Mail, AirDrop, etc. without us hardcoding
    // each channel.
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text })
        return
      } catch (err) {
        // User dismissed the sheet — that's not an error, just stop.
        if (err instanceof DOMException && err.name === 'AbortError') return
        // Any other failure falls through to the WhatsApp link below.
      }
    }

    // Fallback for browsers without the Web Share API (e.g. desktop Firefox):
    // open WhatsApp's share link directly.
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      aria-label="Share prompt"
      className="inline-flex items-center gap-1.5 rounded-md bg-neutral-200/70 px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-300 active:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:active:bg-neutral-700"
    >
      <Share2 className="size-3.5" />
      Share
    </button>
  )
}
