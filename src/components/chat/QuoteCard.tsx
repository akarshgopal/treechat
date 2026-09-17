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
        'text-[14px] italic leading-[1.4] text-muted-foreground text-pretty',
        className,
      )}
    >
      “{quote}”
    </p>
  )
}
