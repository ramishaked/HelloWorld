'use server'

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { analyzePrompt } from '@/lib/gemini'
import { createAdminClient } from '@/lib/supabase-admin'

type ActionResult = { success: true } | { error: string }

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

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
    const buffer = Buffer.from(arrayBuffer)
    const mimeType = file.type || 'image/png'
    const base64 = buffer.toString('base64')

    const admin = createAdminClient()
    const extension = EXTENSION_BY_MIME[mimeType] || 'png'
    const path = `${randomUUID()}.${extension}`

    const { error: uploadError } = await admin.storage
      .from('prompt-images')
      .upload(path, buffer, { contentType: mimeType, upsert: false })

    if (uploadError) return { error: uploadError.message }

    const {
      data: { publicUrl },
    } = admin.storage.from('prompt-images').getPublicUrl(path)

    const analysis = await analyzePrompt({ imageBase64: base64, imageMimeType: mimeType })

    const { error } = await admin.from('prompts').insert({
      title: analysis.title,
      description: analysis.description,
      content: analysis.clean_content,
      image_url: publicUrl,
      tags: analysis.tags,
      raw_analysis: analysis,
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
