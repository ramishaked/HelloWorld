export type Prompt = {
  id: string
  created_at: string
  title: string
  description: string | null
  content: string
  image_url: string | null
  tags: string[]
  raw_analysis: unknown
}
