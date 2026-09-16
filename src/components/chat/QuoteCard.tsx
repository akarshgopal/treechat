import { Quote } from 'lucide-react'
import { cn } from '@/lib/utils'

export function QuoteCard({
  quote,
  className,
}: {
  quote: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex gap-2 rounded-lg border border-primary/20 bg-accent/40 px-3 py-2 text-sm text-foreground',
        className,
      )}
    >
      <Quote className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <p className="italic leading-relaxed">«{quote}»</p>
    </div>
  )
}
