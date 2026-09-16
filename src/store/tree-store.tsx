import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import { createId } from '@/lib/ids'
import { createSeedState } from '@/lib/seed'
import { loadTreeState, saveTreeState } from '@/lib/storage'
import type { Branch, ChatMessage, TreeState } from '@/types'

type Action =
  | { type: 'replace-spine'; messages: ChatMessage[] }
  | { type: 'replace-branch'; branchId: string; messages: ChatMessage[] }
  | { type: 'create-branch'; branch: Branch }
  | { type: 'open-branch'; branchId: string }
  | { type: 'close-branch' }
  | { type: 'discard-branch'; branchId: string }
  | { type: 'open-conversation'; branchId: string }
  | { type: 'back-to-spine' }
  | { type: 'reset' }

function reducer(state: TreeState, action: Action): TreeState {
  switch (action.type) {
    case 'replace-spine':
      return { ...state, spine: action.messages }
    case 'replace-branch':
      return {
        ...state,
        branches: state.branches.map((branch) =>
          branch.id === action.branchId
            ? { ...branch, messages: action.messages }
            : branch,
        ),
      }
    case 'create-branch':
      return {
        ...state,
        branches: [...state.branches, action.branch],
        openBranchId: action.branch.id,
        view: { kind: 'spine' },
      }
    case 'open-branch':
      return {
        ...state,
        openBranchId: action.branchId,
        view: { kind: 'spine' },
      }
    case 'close-branch':
      return { ...state, openBranchId: null }
    case 'discard-branch': {
      const remaining = state.branches.filter((branch) => branch.id !== action.branchId)
      const view =
        state.view.kind === 'conversation' && state.view.branchId === action.branchId
          ? { kind: 'spine' as const }
          : state.view
      return {
        ...state,
        branches: remaining,
        openBranchId: state.openBranchId === action.branchId ? null : state.openBranchId,
        view,
      }
    }
    case 'open-conversation':
      return {
        ...state,
        openBranchId: action.branchId,
        view: { kind: 'conversation', branchId: action.branchId },
      }
    case 'back-to-spine':
      return {
        ...state,
        view: { kind: 'spine' },
        openBranchId: state.view.kind === 'conversation' ? state.view.branchId : state.openBranchId,
      }
    case 'reset':
      return createSeedState()
    default:
      return state
  }
}

type TreeContextValue = {
  state: TreeState
  activeBranch: Branch | null
  createBranch: (
    sourceMessageId: string,
    start: number,
    end: number,
    quote: string,
  ) => string
  openBranch: (branchId: string) => void
  closeBranch: () => void
  discardBranch: (branchId: string) => void
  openConversation: (branchId: string) => void
  backToSpine: () => void
  replaceSpine: (messages: ChatMessage[]) => void
  replaceBranchMessages: (branchId: string, messages: ChatMessage[]) => void
  resetDemo: () => void
  branchesForMessage: (messageId: string) => Branch[]
}

const TreeContext = createContext<TreeContextValue | null>(null)

export function TreeProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, null, loadTreeState)

  useEffect(() => {
    saveTreeState(state)
  }, [state])

  const activeBranch = useMemo(() => {
    const id =
      state.view.kind === 'conversation' ? state.view.branchId : state.openBranchId
    return state.branches.find((branch) => branch.id === id) ?? null
  }, [state])

  const createBranch = useCallback(
    (sourceMessageId: string, start: number, end: number, quote: string) => {
      const existing = state.branches.find(
        (branch) =>
          branch.sourceMessageId === sourceMessageId &&
          branch.start === start &&
          branch.end === end,
      )
      if (existing) {
        dispatch({ type: 'open-branch', branchId: existing.id })
        return existing.id
      }
      const branch: Branch = {
        id: createId('branch'),
        sourceMessageId,
        start,
        end,
        quote,
        messages: [],
        createdAt: Date.now(),
      }
      dispatch({ type: 'create-branch', branch })
      return branch.id
    },
    [state.branches],
  )

  const value = useMemo<TreeContextValue>(
    () => ({
      state,
      activeBranch,
      createBranch,
      openBranch: (branchId) => dispatch({ type: 'open-branch', branchId }),
      closeBranch: () => dispatch({ type: 'close-branch' }),
      discardBranch: (branchId) => dispatch({ type: 'discard-branch', branchId }),
      openConversation: (branchId) =>
        dispatch({ type: 'open-conversation', branchId }),
      backToSpine: () => dispatch({ type: 'back-to-spine' }),
      replaceSpine: (messages) => dispatch({ type: 'replace-spine', messages }),
      replaceBranchMessages: (branchId, messages) =>
        dispatch({ type: 'replace-branch', branchId, messages }),
      resetDemo: () => dispatch({ type: 'reset' }),
      branchesForMessage: (messageId) =>
        state.branches.filter((branch) => branch.sourceMessageId === messageId),
    }),
    [state, activeBranch, createBranch],
  )

  return <TreeContext.Provider value={value}>{children}</TreeContext.Provider>
}

export function useTree() {
  const value = useContext(TreeContext)
  if (!value) throw new Error('useTree must be used within TreeProvider')
  return value
}
