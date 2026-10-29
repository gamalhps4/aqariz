import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "bg-gradient-to-r from-muted via-muted/50 to-muted rounded-xl",
        "dark:from-muted/30 dark:via-muted/10 dark:to-muted/30",
        "relative overflow-hidden",
        "before:absolute before:inset-0",
        "before:bg-gradient-to-r before:from-transparent before:via-white/30 before:to-transparent",
        "dark:before:via-white/10",
        "before:animate-shimmer",
        "shadow-sm border border-border/30",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
