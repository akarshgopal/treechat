import { TooltipProvider } from '@/components/ui/tooltip'
import { TreeChatApp } from '@/components/chat/TreeChatApp'
import { TreeProvider } from '@/store/tree-store'

export default function App() {
  return (
    <TooltipProvider delayDuration={200}>
      <TreeProvider>
        <TreeChatApp />
      </TreeProvider>
    </TooltipProvider>
  )
}
