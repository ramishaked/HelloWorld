'use server'

import { revalidatePath } from 'next/cache'
import { analyzePrompt, translateText } from '@/lib/gemini'
import { createAdminClient } from '@/lib/supabase-admin'

type ActionResult = { success: true } | { error: string }

export async function createPromptFromText(text: string): Promise<ActionResult> {
  const trimmed = text.trim()
  if (!trimmed) {
    return { error: 'Nothing to save.' }
  }

  try {
    const analysis = await analyzePrompt({ text: trimmed })
    const admin = createAdminClient()
    const { error } = await admin.from('prompts').insert({
      title: analysis.title,
      description: analysis.description,
      content: analysis.clean_content,
      tags: analysis.tags,
      raw_analysis: analysis,
      media_type: analysis.media_type,
    })

    if (error) return { error: error.message }

    revalidatePath('/')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to save prompt.' }
  }
}

export async function createPromptFromImage(formData: FormData): Promise<ActionResult> {
  const file = formData.get('image')
  if (!(file instanceof File)) {
    return { error: 'No image provided.' }
  }

  try {
    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const mimeType = file.type || 'image/png'

    // OCR happens here; only the extracted text is persisted — the image
    // itself is never uploaded or stored.
    const analysis = await analyzePrompt({ imageBase64: base64, imageMimeType: mimeType })

    const admin = createAdminClient()
    const { error } = await admin.from('prompts').insert({
      title: analysis.title,
      description: analysis.description,
      content: analysis.clean_content,
      tags: analysis.tags,
      raw_analysis: analysis,
      media_type: analysis.media_type,
    })

    if (error) return { error: error.message }

    revalidatePath('/')
    return { success: true }
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
