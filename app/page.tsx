import { Dashboard } from '@/components/dashboard'
import { getPrompts } from '@/lib/get-prompts'

// This dashboard always needs the latest prompts, so opt out of static
// prerendering rather than baking a snapshot in at build time.
export const dynamic = 'force-dynamic'

export default async function Home() {
  const prompts = await getPrompts()
  return <Dashboard initialPrompts={prompts} />
}
