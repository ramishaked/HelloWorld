import type { Language } from '@/lib/types'

// Replies mirror the language the user wrote in, so a Hebrew message never gets
// answered in English.

export const reply = {
  created(language: Language, title: string, when: string, location: string | null, link: string | null): string {
    const lines =
      language === 'he'
        ? [`✅ נקבע: ${title}`, `🗓 ${when}`]
        : [`✅ Added: ${title}`, `🗓 ${when}`]

    if (location) lines.push(`📍 ${location}`)
    if (link) lines.push(link)
    return lines.join('\n')
  },

  cancelled(language: Language): string {
    return language === 'he' ? 'בוטל. לא נקבע כלום.' : 'Cancelled — nothing was scheduled.'
  },

  nothingToCancel(language: Language): string {
    return language === 'he' ? 'אין בקשה פתוחה לבטל.' : 'There is no pending request to cancel.'
  },

  unclear(language: Language): string {
    return language === 'he'
      ? 'לא זיהיתי כאן פגישה. אפשר לכתוב משהו כמו "פגישה עם דני מחר ב-15:00".'
      : 'I could not find an appointment in that. Try something like "meeting with Dan tomorrow at 3pm".'
  },

  unsupported(language: Language): string {
    return language === 'he'
      ? 'אני קורא טקסט, תמונות והודעות קוליות בלבד.'
      : 'I can read text, images and voice notes only.'
  },

  failed(language: Language): string {
    return language === 'he'
      ? 'משהו השתבש ולא הצלחתי לקבוע את זה. אפשר לנסות לנסח מחדש?'
      : "Something went wrong and I couldn't schedule that. Could you rephrase it?"
  },

  notConnected(language: Language): string {
    return language === 'he'
      ? 'יומן Google עדיין לא מחובר. צריך לפתוח את /api/auth/google פעם אחת.'
      : 'Google Calendar is not connected yet — visit /api/auth/google once to authorise it.'
  },

  /** Fallback when the model flags something missing but writes no question. */
  askFallback(language: Language, missing: string[]): string {
    const wantsTitle = missing.includes('title')
    const wantsStart = missing.includes('start')

    if (language === 'he') {
      if (wantsTitle && wantsStart) return 'מה הנושא ומתי?'
      if (wantsTitle) return 'איך לקרוא לפגישה?'
      return 'מתי לקבוע את זה?'
    }
    if (wantsTitle && wantsStart) return "What's it about, and when?"
    if (wantsTitle) return 'What should I call it?'
    return 'When should I schedule it?'
  },
}
