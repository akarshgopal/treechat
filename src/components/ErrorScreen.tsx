import { Component, type ErrorInfo, type ReactNode } from 'react'
import { newIssueUrl } from '@/lib/links'
import { loadLibrary } from '@/lib/storage'
import { exportChats } from '@/lib/transfer'

type State = { error: Error | null; exported: 'idle' | 'done' | 'failed' }

/**
 * If the app crashes while rendering, say so instead of leaving a blank page,
 * and keep the way out open: reload, save every chat, or report it. Chats are
 * read straight from storage, so this works whatever state the app was in.
 */
export class ErrorScreen extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, exported: 'idle' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('TreeChat crashed', error, info.componentStack)
  }

  private exportAll = async () => {
    try {
      await exportChats((await loadLibrary()).sessions)
      this.setState({ exported: 'done' })
    } catch {
      this.setState({ exported: 'failed' })
    }
  }

  render() {
    const { error, exported } = this.state
    if (!error) return this.props.children
    const details = `${error.name}: ${error.message}\n\n${error.stack ?? ''}`.trim()
    const report = newIssueUrl({
      title: `Crash: ${error.message}`.slice(0, 120),
      body: `**What I was doing:**\n\n\n**Browser:** ${navigator.userAgent}\n\n\`\`\`\n${details}\n\`\`\``,
    })
    return (
      <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground" role="alert" data-testid="error-screen">
        <div className="flex w-full max-w-md flex-col gap-4">
          <h1 className="text-[15px] font-medium">Something broke.</h1>
          <p className="text-[13px] text-muted-foreground">
            TreeChat hit an error it could not recover from. Your chats are still saved in this browser. Reloading usually
            fixes it; if it keeps happening, save your chats first, then report it.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
            <button type="button" className="btn btn-outline" onClick={() => void this.exportAll()} data-testid="error-export">
              {exported === 'done' ? 'Chats saved' : exported === 'failed' ? 'Export failed — try again' : 'Export my chats'}
            </button>
            <a className="btn btn-outline" href={report} target="_blank" rel="noopener noreferrer">Report this problem</a>
          </div>
          <details className="rounded-lg border border-border text-xs text-muted-foreground">
            <summary className="cursor-pointer px-3 py-2">Error details</summary>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap border-t border-border p-3 font-mono">{details}</pre>
          </details>
        </div>
      </main>
    )
  }
}
