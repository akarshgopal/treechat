import { ErrorScreen } from '@/components/ErrorScreen'
import { TreeChatApp } from '@/components/chat/TreeChatApp'
import { TreeProvider } from '@/store/tree-store'

export default function App() {
  return (
    <ErrorScreen>
      <TreeProvider>
        <TreeChatApp />
      </TreeProvider>
    </ErrorScreen>
  )
}
