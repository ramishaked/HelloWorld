import { Dashboard } from '@/components/dashboard'
import { getPrompts } from '@/lib/get-prompts'

// This dashboard always needs the latest prompts, so opt out of static
// prerendering rather than baking a snapshot in at build time.
export const dynamic = 'force-dynamic'

// Server Actions inherit this page's function config on Vercel. Give Gemini
// calls (paste enrichment, re-analyze, image OCR) headroom over the ~10s
// default so they aren't killed mid-call.
export const maxDuration = 60

export default async function Home() {
  const prompts = await getPrompts()
  return <Dashboard initialPrompts={prompts} />
}
