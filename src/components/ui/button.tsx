import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive active:scale-98",
  {
    variants: {
      variant: {
        default:
          "gradient-primary text-primary-foreground shadow-md hover:shadow-lg hover:opacity-90",
        destructive:
          "gradient-error text-white shadow-md hover:shadow-lg hover:opacity-90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "border border-border/60 bg-card/70 backdrop-blur-sm shadow-sm hover:bg-card hover:text-accent-foreground hover:border-border/80 hover:shadow-md",
        secondary:
          "bg-secondary/90 backdrop-blur-sm text-secondary-foreground shadow-sm hover:bg-secondary hover:shadow-md",
        ghost:
          "hover:bg-accent/70 hover:text-accent-foreground hover:backdrop-blur-sm",
        link: "text-primary underline-offset-4 hover:underline hover:text-primary-light",
      },
      size: {
        default: "h-10 px-6 py-2.5 has-[>svg]:px-4",
        sm: "h-8 rounded-lg gap-1.5 px-4 has-[>svg]:px-3",
        lg: "h-12 rounded-xl px-8 has-[>svg]:px-6 text-base",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
