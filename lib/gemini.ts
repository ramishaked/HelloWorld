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
7. Classify "category": the single subject area this prompt is about, used to group prompts into clusters. \
Use 1-3 words in Title Case. Pick the subject that best captures what the prompt actually does — choose \
distinct, well-separated subjects and do NOT force unrelated prompts into the same bucket. Good examples: \
"Image Generation", "Video Generation", "Coding", "Writing", "Marketing", "Research", "Data Analysis", \
"Learning", "Productivity", "Design". If a list of existing subjects is provided, reuse one of those names \
ONLY when this prompt is genuinely about that same area (this just keeps naming consistent, e.g. avoids \
"Learning" vs "Education"); if the prompt is about a different area, create a new concise subject rather \
than forcing a loose fit.

Always respond with the required JSON fields only.`

export type MediaType = 'image' | 'video' | 'text'

export type PromptAnalysis = {
  title: string
  description: string
  tags: string[]
  clean_content: string
  media_type: MediaType
  category: string
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
    category: { type: Type.STRING },
  },
  required: ['title', 'description', 'tags', 'clean_content', 'media_type', 'category'],
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
      thinkingConfig: { thinkingBudget: 0 },
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
  knownCategories?: string[]
}): Promise<PromptAnalysis> {
  const parts: Part[] = []

  if (input.imageBase64 && input.imageMimeType) {
    parts.push(createPartFromBase64(input.imageBase64, input.imageMimeType))
  }
  if (input.text) {
    parts.push({ text: input.text })
  }

  // Feed back the subjects already in use only as a naming-consistency hint —
  // reuse a name when the area truly matches, but don't collapse different
  // prompts into one bucket (see instruction 7).
  if (input.knownCategories && input.knownCategories.length > 0) {
    parts.push({
      text: `Existing subjects (for naming consistency only — reuse one of these for "category" ONLY if this prompt is truly about that same area, otherwise create a new distinct subject): ${input.knownCategories
        .slice(0, 50)
        .join(', ')}`,
    })
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
      // Disable "thinking" — this is structured extraction/classification, not
      // reasoning, so thinking only adds latency and cost (and can push a call
      // past the serverless timeout). Big speedup for enrichment & re-analyze.
      thinkingConfig: { thinkingBudget: 0 },
    },
  })

  const raw = response.text
  if (!raw) {
    throw new Error('Gemini returned an empty response.')
  }

  const parsed = JSON.parse(raw) as Partial<PromptAnalysis>
  const mediaType: MediaType =
    parsed.media_type === 'image' || parsed.media_type === 'video' ? parsed.media_type : 'text'

  const category =
    typeof parsed.category === 'string' && parsed.category.trim()
      ? parsed.category.trim().slice(0, 40)
      : 'General'

  return {
    title: (parsed.title || 'Untitled prompt').slice(0, 120),
    description: parsed.description || '',
    tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5).map(String) : [],
    clean_content: parsed.clean_content || input.text || '',
    media_type: mediaType,
    category,
  }
}
