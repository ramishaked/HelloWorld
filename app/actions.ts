'use server'

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { analyzePrompt, clusterSubjects, translateText, type PromptAnalysis } from '@/lib/gemini'
import { createAdminClient } from '@/lib/supabase-admin'
import type { SupabaseClient } from '@supabase/supabase-js'

const EXAMPLE_BUCKET = 'prompt-images'

type ActionResult = { success: true } | { error: string }
type SaveResult = { success: true } | { duplicate: true } | { error: string }

// Returns true if a prompt with identical content already exists, so we don't
// save the same thing twice.
async function contentExists(admin: SupabaseClient, content: string): Promise<boolean> {
  const { data } = await admin.from('prompts').select('id').eq('content', content).limit(1)
  return (data?.length ?? 0) > 0
}

// The distinct subjects already in use, fed back to Gemini so it reuses them
// instead of coining near-duplicates.
async function getKnownCategories(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin.from('prompts').select('category').not('category', 'is', null)
  const set = new Set<string>()
  for (const row of data ?? []) {
    if (row.category) set.add(row.category as string)
  }
  return Array.from(set)
}

async function insertAnalyzedPrompt(
  admin: SupabaseClient,
  analysis: PromptAnalysis
): Promise<SaveResult> {
  if (await contentExists(admin, analysis.clean_content)) {
    return { duplicate: true }
  }

  const { error } = await admin.from('prompts').insert({
    title: analysis.title,
    description: analysis.description,
    content: analysis.clean_content,
    tags: analysis.tags,
    raw_analysis: analysis,
    media_type: analysis.media_type,
    category: analysis.category,
  })
  if (error) return { error: error.message }

  revalidatePath('/')
  return { success: true }
}

export async function createPromptFromText(text: string): Promise<SaveResult> {
  const trimmed = text.trim()
  if (!trimmed) {
    return { error: 'Nothing to save.' }
  }

  try {
    const admin = createAdminClient()
    const knownCategories = await getKnownCategories(admin)
    const analysis = await analyzePrompt({ text: trimmed, knownCategories })
    return await insertAnalyzedPrompt(admin, analysis)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to save prompt.' }
  }
}

export async function createPromptFromImage(formData: FormData): Promise<SaveResult> {
  const file = formData.get('image')
  if (!(file instanceof File)) {
    return { error: 'No image provided.' }
  }

  try {
    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const mimeType = file.type || 'image/png'

    const admin = createAdminClient()
    const knownCategories = await getKnownCategories(admin)
    // OCR happens here; only the extracted text is persisted — the image
    // itself is never uploaded or stored.
    const analysis = await analyzePrompt({ imageBase64: base64, imageMimeType: mimeType, knownCategories })
    return await insertAnalyzedPrompt(admin, analysis)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to save prompt.' }
  }
}

export async function deletePrompt(id: string): Promise<ActionResult> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('prompts').delete().eq('id', id)
    if (error) return { error: error.message }

    revalidatePath('/')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to delete prompt.' }
  }
}

export async function toggleFavorite(id: string, isFavorite: boolean): Promise<ActionResult> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('prompts').update({ is_favorite: isFavorite }).eq('id', id)
    if (error) return { error: error.message }

    revalidatePath('/')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to update favorite.' }
  }
}

// Derive the storage object path from a public URL so we can delete it later.
function storagePathFromUrl(url: string | null): string | null {
  if (!url) return null
  const marker = `/${EXAMPLE_BUCKET}/`
  const i = url.indexOf(marker)
  return i === -1 ? null : url.slice(i + marker.length)
}

// Uploads a user-attached example output image for a prompt and stores its URL.
export async function setExampleImage(
  promptId: string,
  formData: FormData
): Promise<{ url: string } | { error: string }> {
  const file = formData.get('image')
  if (!(file instanceof File)) return { error: 'No image provided.' }

  try {
    const admin = createAdminClient()
    const buffer = Buffer.from(await file.arrayBuffer())
    const path = `examples/${randomUUID()}.jpg`

    const { error: uploadError } = await admin.storage
      .from(EXAMPLE_BUCKET)
      .upload(path, buffer, { contentType: file.type || 'image/jpeg', upsert: false })
    if (uploadError) return { error: uploadError.message }

    const {
      data: { publicUrl },
    } = admin.storage.from(EXAMPLE_BUCKET).getPublicUrl(path)

    // Grab the previous image (to clean up) then point the prompt at the new one.
    const { data: prev } = await admin
      .from('prompts')
      .select('example_image_url')
      .eq('id', promptId)
      .single()

    const { error } = await admin
      .from('prompts')
      .update({ example_image_url: publicUrl })
      .eq('id', promptId)
    if (error) return { error: error.message }

    const oldPath = storagePathFromUrl(prev?.example_image_url ?? null)
    if (oldPath) await admin.storage.from(EXAMPLE_BUCKET).remove([oldPath])

    revalidatePath('/')
    return { url: publicUrl }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to upload example image.' }
  }
}

export async function removeExampleImage(promptId: string): Promise<ActionResult> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('prompts')
      .select('example_image_url')
      .eq('id', promptId)
      .single()

    const { error } = await admin
      .from('prompts')
      .update({ example_image_url: null })
      .eq('id', promptId)
    if (error) return { error: error.message }

    const path = storagePathFromUrl(data?.example_image_url ?? null)
    if (path) await admin.storage.from(EXAMPLE_BUCKET).remove([path])

    revalidatePath('/')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to remove example image.' }
  }
}

export async function updatePromptTitle(id: string, title: string): Promise<ActionResult> {
  const trimmed = title.trim()
  if (!trimmed) return { error: 'Title cannot be empty.' }

  try {
    const admin = createAdminClient()
    const { error } = await admin
      .from('prompts')
      .update({ title: trimmed.slice(0, 120) })
      .eq('id', id)
    if (error) return { error: error.message }

    revalidatePath('/')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to update title.' }
  }
}

// View-only: returns the translated text without persisting anything, so the
// card can toggle between the original and a translation.
export async function translatePrompt(
  text: string,
  targetLanguage: string
): Promise<{ text: string } | { error: string }> {
  const trimmed = text.trim()
  if (!trimmed) return { error: 'Nothing to translate.' }

  try {
    const translated = await translateText(trimmed, targetLanguage)
    return { text: translated }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to translate.' }
  }
}

export type PromptPatch = {
  content?: string
  description?: string
  tags?: string[]
}

export async function updatePrompt(id: string, patch: PromptPatch): Promise<ActionResult> {
  const update: Record<string, unknown> = {}

  if (patch.content !== undefined) {
    const content = patch.content.trim()
    if (!content) return { error: 'Content cannot be empty.' }
    update.content = content
  }
  if (patch.description !== undefined) {
    update.description = patch.description.trim()
  }
  if (patch.tags !== undefined) {
    update.tags = patch.tags.map((t) => t.trim()).filter(Boolean).slice(0, 12)
  }

  if (Object.keys(update).length === 0) return { success: true }

  try {
    const admin = createAdminClient()
    const { error } = await admin.from('prompts').update(update).eq('id', id)
    if (error) return { error: error.message }

    revalidatePath('/')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to update prompt.' }
  }
}

// Re-runs Gemini enrichment on an existing prompt's content and refreshes its
// classification/metadata. The (possibly hand-edited) title and content are
// preserved on purpose — only description, tags, media_type, category,
// raw_analysis change. This is what backfills `category` onto older prompts.
// `revalidate` is skipped during bulk runs so the page refetches once at the end
// rather than after every single prompt.
export async function reanalyzePrompt(id: string, revalidate = true): Promise<ActionResult> {
  try {
    const admin = createAdminClient()
    const { data, error: fetchError } = await admin
      .from('prompts')
      .select('content')
      .eq('id', id)
      .single()
    if (fetchError) return { error: fetchError.message }
    if (!data?.content) return { error: 'Prompt has no content to analyze.' }

    const knownCategories = await getKnownCategories(admin)
    const analysis = await analyzePrompt({ text: data.content, knownCategories })
    const { error } = await admin
      .from('prompts')
      .update({
        description: analysis.description,
        tags: analysis.tags,
        media_type: analysis.media_type,
        category: analysis.category,
        raw_analysis: analysis,
      })
      .eq('id', id)
    if (error) return { error: error.message }

    if (revalidate) revalidatePath('/')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to re-analyze prompt.' }
  }
}

// Re-derives subjects across the WHOLE vault in a single Gemini call and
// rewrites every prompt's category, so clusters stay coherent and consolidated.
// One AI call regardless of prompt count (previously it was one call per prompt).
export async function reclusterSubjects(): Promise<
  { subjects: number; updated: number } | { error: string }
> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from('prompts').select('id, title, description')
    if (error) return { error: error.message }

    const prompts = (data ?? []) as { id: string; title: string; description: string | null }[]
    if (prompts.length === 0) return { subjects: 0, updated: 0 }

    const assignments = await clusterSubjects(prompts)

    let updated = 0
    for (const { id, subject } of assignments) {
      const { error: upErr } = await admin.from('prompts').update({ category: subject }).eq('id', id)
      if (!upErr) updated++
    }

    revalidatePath('/')
    return { subjects: new Set(assignments.map((a) => a.subject)).size, updated }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to reorganize subjects.' }
  }
}

export type ImportRow = {
  title?: unknown
  content?: unknown
  description?: unknown
  tags?: unknown
  media_type?: unknown
  is_favorite?: unknown
  category?: unknown
}

// Inserts prompts from a backup file. Rows whose content already exists are
// skipped, so re-importing a backup won't create duplicates.
export async function importPrompts(
  rows: ImportRow[]
): Promise<{ imported: number; skipped: number } | { error: string }> {
  if (!Array.isArray(rows)) return { error: 'Invalid import file.' }

  const validMedia = new Set(['image', 'video', 'text'])
  try {
    const admin = createAdminClient()
    let imported = 0
    let skipped = 0

    for (const row of rows) {
      const content = typeof row.content === 'string' ? row.content.trim() : ''
      if (!content) {
        skipped++
        continue
      }
      if (await contentExists(admin, content)) {
        skipped++
        continue
      }

      const media = typeof row.media_type === 'string' && validMedia.has(row.media_type)
        ? row.media_type
        : 'text'
      const { error } = await admin.from('prompts').insert({
        title: typeof row.title === 'string' && row.title.trim() ? row.title.trim().slice(0, 120) : 'Untitled prompt',
        description: typeof row.description === 'string' ? row.description : null,
        content,
        tags: Array.isArray(row.tags) ? row.tags.map(String).slice(0, 12) : [],
        media_type: media,
        is_favorite: row.is_favorite === true,
        category:
          typeof row.category === 'string' && row.category.trim()
            ? row.category.trim().slice(0, 40)
            : null,
      })
      if (error) return { error: error.message }
      imported++
    }

    revalidatePath('/')
    return { imported, skipped }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to import prompts.' }
  }
}
