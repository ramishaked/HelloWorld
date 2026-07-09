import { GoogleGenAI, Type, createPartFromBase64, type Part } from '@google/genai'

// Use the "-latest" alias, which always tracks the current flash-lite model, so
// it won't 404 when Google retires a pinned version (as happened to
// gemini-2.5-flash-lite AND gemini-2.5-flash). It's multimodal (image OCR) and
// light on the free tier. Verified live with our exact config (JSON schema +
// thinkingBudget 0). ListModels is unreliable — confirm generateContent actually
// responds before switching. GEMINI_MODEL overrides at runtime.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest'

const SYSTEM_INSTRUCTION = `You are the enrichment engine for PromptVault, a tool developers use to \
save and reuse AI prompts. You will receive either pasted text or a screenshot/image \
(which may contain a prompt as text, e.g. a screenshot of a chat UI or editor).

Your job:
1. If given an image, run OCR / read the visible text and identify the actual prompt content within it.
2. Determine a short, punchy title (max 8 words) that describes what the prompt does.
3. Write a one-sentence description of the prompt's purpose.
4. Produce 3-5 short lowercase keyword tags for filtering (single words or short phrases, no hashtags).
5. Produce "clean_content": the prompt text itself, cleaned up (fix obvious OCR artifacts, trim boilerplate \
chat UI chrome like timestamps or button labels) but preserving the actual prompt wording and intent. \
Normalize fill-in placeholders: if the prompt is a reusable template with slots the user is meant to \
replace — written in ANY style such as [topic], <topic>, {topic}, \${topic}, {{topic}}, an ALL-CAPS token \
like TOPIC, or a blank like ____ — rewrite each such slot as {{snake_case_name}} (a short lowercase name). \
Do NOT convert code, JSON keys/values, HTML/XML tags, markdown links, citations like [1], or ordinary \
literal words into placeholders — only genuine user-fill slots.
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

function parseRetryDelayMs(err: unknown): number | null {
  const msg = (err as { message?: string })?.message
  if (typeof msg !== 'string') return null
  const m = msg.match(/"retryDelay":"(\d+(?:\.\d+)?)s"/)
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null
}

// The Gemini free tier has low request limits, so a burst (e.g. a bulk
// re-analyze) intermittently gets 429s. Retry those a couple of times,
// honoring the API's suggested delay, so a transient limit doesn't surface as
// a failure. On a persistent limit, throw a clean, human-readable message
// instead of the raw error JSON.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const maxRetries = 2
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const status = (err as { status?: number })?.status
      const retriable = status === 429 || status === 503 || status === 500
      if (retriable && attempt < maxRetries) {
        const waitMs = Math.min(20000, (parseRetryDelayMs(err) ?? 2500 * 2 ** attempt) + 500)
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        continue
      }
      if (status === 429) {
        throw new Error(
          'Gemini rate limit reached — the free tier has low limits. Wait a minute and try again.'
        )
      }
      throw err
    }
  }
}

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  const response = await withRetry(() =>
    getClient().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text }] }],
    config: {
      systemInstruction: `You are a translation engine. Translate the user's text into ${targetLanguage}. \
Preserve the meaning, tone, line breaks, and any placeholders, variables, or code. \
Output ONLY the translated text — no preamble, quotes, or explanation.`,
      thinkingConfig: { thinkingBudget: 0 },
    },
    })
  )

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

  const response = await withRetry(() =>
    getClient().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema,
        // Disable "thinking" — this is structured extraction/classification,
        // not reasoning, so thinking only adds latency and cost (and can push a
        // call past the serverless timeout). Big speedup for enrichment.
        thinkingConfig: { thinkingBudget: 0 },
      },
    })
  )

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

const CLUSTER_INSTRUCTION = `You organize a personal library of AI prompts into a small, coherent set of \
subjects (clusters). You are given a numbered list of prompts as "title — description".

Group them into broad, high-level subjects such as "Learning", "Image Generation", "Video Generation", \
"Coding", "Writing", "Marketing", "Research", "Productivity", "Design".

Rules:
- Use a TIGHT, consistent set of subjects. Merge near-duplicates (never both "Coding" and "Programming").
- Aim for roughly 3-8 subjects for a collection this size — fewer if the prompts are genuinely similar. \
NEVER create one subject per prompt, and don't force everything into a single subject unless they truly \
all share one theme.
- Assign EVERY prompt to exactly one subject, referenced by its number.
- Subjects are 1-3 words, Title Case.`

const clusterSchema = {
  type: Type.OBJECT,
  properties: {
    assignments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          index: { type: Type.INTEGER },
          subject: { type: Type.STRING },
        },
        required: ['index', 'subject'],
      },
    },
  },
  required: ['assignments'],
}

export type SubjectAssignment = { id: string; subject: string }

// Global, single-call re-clustering: sees ALL prompts at once and returns a
// coherent subject for each, so clusters stay consolidated instead of the
// order-dependent drift of categorizing one prompt at a time.
export async function clusterSubjects(
  prompts: { id: string; title: string; description: string | null }[]
): Promise<SubjectAssignment[]> {
  if (prompts.length === 0) return []

  const list = prompts
    .map((p, i) => `${i + 1}. ${p.title}${p.description ? ` — ${p.description}` : ''}`)
    .join('\n')

  const response = await withRetry(() =>
    getClient().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: list }] }],
      config: {
        systemInstruction: CLUSTER_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: clusterSchema,
        thinkingConfig: { thinkingBudget: 0 },
      },
    })
  )

  const raw = response.text
  if (!raw) {
    throw new Error('Gemini returned an empty response.')
  }

  const parsed = JSON.parse(raw) as { assignments?: { index?: number; subject?: string }[] }
  const result: SubjectAssignment[] = []
  for (const a of parsed.assignments ?? []) {
    const prompt = typeof a.index === 'number' ? prompts[a.index - 1] : undefined
    const subject = typeof a.subject === 'string' ? a.subject.trim().slice(0, 40) : ''
    if (prompt && subject) result.push({ id: prompt.id, subject })
  }
  return result
}
