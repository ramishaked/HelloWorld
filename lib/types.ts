export type Prompt = {
  id: string
  created_at: string
  title: string
  description: string | null
  content: string
  tags: string[]
  raw_analysis: unknown
  is_favorite: boolean
}
