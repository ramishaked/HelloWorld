import { GoogleGenAI, Type, createPartFromBase64, type Part } from '@google/genai'

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

const SYSTEM_INSTRUCTION = `You are the enrichment engine for PromptVault, a tool developers use to \
save and reuse AI prompts. You will receive either pasted text or a screenshot/image \
(which may contain a prompt as text, e.g. a screenshot of a chat UI or editor).

Your job:
1. If given an image, run OCR / read the visible text and identify the actual prompt content within it.
2. Determine a short, punchy title (max 8 words) that describes what the prompt does.
3. Write a one-sentence description of the prompt's purpose.
4. Produce 3-5 short lowercase keyword tags for filtering (single words or short phrases, no hashtags).
5. Produce "clean_content": the prompt text itself, cleaned up (fix obvious OCR artifacts, trim boilerplate \
chat UI chrome like timestamps or button labels) but preserving the actual prompt wording and intent.
6. Classify "media_type": is this prompt written to make a generative model produce an IMAGE (e.g. a \
Midjourney/DALL-E/Stable Diffusion/Imagen-style visual description), a VIDEO (e.g. a Sora/Veo/Runway-style \
shot description), or is it a regular text/chat prompt with no media-generation intent? Respond with \
exactly one of: "image", "video", "text".

Always respond with the required JSON fields only.`

export type MediaType = 'image' | 'video' | 'text'

export type PromptAnalysis = {
  title: string
  description: string
  tags: string[]
  clean_content: string
  media_type: MediaType
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    description: { type: Type.STRING },
    tags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    clean_content: { type: Type.STRING },
    media_type: { type: Type.STRING, enum: ['image', 'video', 'text'] },
  },
  required: ['title', 'description', 'tags', 'clean_content', 'media_type'],
}

let client: GoogleGenAI | null = null

function getClient() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error('Missing GEMINI_API_KEY environment variable.')
    }
    client = new GoogleGenAI({ apiKey })
  }
  return client
}

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  const response = await getClient().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text }] }],
    config: {
      systemInstruction: `You are a translation engine. Translate the user's text into ${targetLanguage}. \
Preserve the meaning, tone, line breaks, and any placeholders, variables, or code. \
Output ONLY the translated text — no preamble, quotes, or explanation.`,
    },
  })

  const raw = response.text
  if (!raw) {
    throw new Error('Translation returned an empty response.')
  }
  return raw.trim()
}

export async function analyzePrompt(input: {
  text?: string
  imageBase64?: string
  imageMimeType?: string
}): Promise<PromptAnalysis> {
  const parts: Part[] = []

  if (input.imageBase64 && input.imageMimeType) {
    parts.push(createPartFromBase64(input.imageBase64, input.imageMimeType))
  }
  if (input.text) {
    parts.push({ text: input.text })
  }

  if (parts.length === 0) {
    throw new Error('analyzePrompt requires text and/or an image.')
  }

  const response = await getClient().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema,
    },
  })

  const raw = response.text
  if (!raw) {
    throw new Error('Gemini returned an empty response.')
  }

  const parsed = JSON.parse(raw) as Partial<PromptAnalysis>
  const mediaType: MediaType =
    parsed.media_type === 'image' || parsed.media_type === 'video' ? parsed.media_type : 'text'

  return {
    title: (parsed.title || 'Untitled prompt').slice(0, 120),
    description: parsed.description || '',
    tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5).map(String) : [],
    clean_content: parsed.clean_content || input.text || '',
    media_type: mediaType,
  }
}
