import { cn } from '@/lib/utils'

export function QuoteCard({
  quote,
  className,
}: {
  quote: string
  className?: string
}) {
  return (
    <p
      className={cn(
        'text-[13.5px] italic leading-[1.45] text-muted-foreground text-pretty',
        className,
      )}
    >
      “{quote}”
    </p>
  )
}
