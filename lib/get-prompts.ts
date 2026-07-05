import { createAdminClient } from '@/lib/supabase-admin'
import type { Prompt } from '@/lib/types'

export async function getPrompts(): Promise<Prompt[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('prompts')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to load prompts: ${error.message}`)
  }

  return data ?? []
}
