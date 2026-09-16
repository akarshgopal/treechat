export type Role = 'user' | 'assistant'

export type MessageKind = 'message' | 'drop-summary'

export type ChatMessage = {
  id: string
  role: Role
  content: string
  createdAt: number
  kind?: MessageKind
  quote?: string
}

export type Branch = {
  id: string
  sourceMessageId: string
  start: number
  end: number
  quote: string
  messages: ChatMessage[]
  createdAt: number
}

export type ViewMode =
  | { kind: 'spine' }
  | { kind: 'conversation'; branchId: string }

export type TreeState = {
  spine: ChatMessage[]
  branches: Branch[]
  openBranchId: string | null
  view: ViewMode
}

export type ProviderStatus = {
  mode: 'mock' | 'live'
  provider: 'xai' | 'openai' | 'openrouter' | 'mock'
  model: string
}

export const STORAGE_KEY = 'treechat:v1'
