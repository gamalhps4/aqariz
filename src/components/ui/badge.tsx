import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-lg border px-2.5 py-1 text-xs font-semibold w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1.5 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-all duration-150 overflow-hidden backdrop-blur-sm",
  {
    variants: {
      variant: {
        default:
          "border-primary/20 bg-primary/10 text-primary [a&]:hover:bg-primary/20",
        secondary:
          "border-secondary/20 bg-secondary/50 text-secondary-foreground [a&]:hover:bg-secondary/70",
        destructive:
          "border-error/20 bg-error/10 text-error [a&]:hover:bg-error/20",
        outline:
          "border-border/40 text-foreground [a&]:hover:bg-accent/50 [a&]:hover:text-accent-foreground",
        success:
          "border-success/20 bg-success/10 text-success [a&]:hover:bg-success/20",
        warning:
          "border-warning/20 bg-warning/10 text-warning [a&]:hover:bg-warning/20",
        info: "border-info/20 bg-info/10 text-info [a&]:hover:bg-info/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
