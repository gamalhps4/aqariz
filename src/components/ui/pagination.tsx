"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"

import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { useUiText } from "@/components/ui/use-ui-text"

const Pagination = ({ className, ...props }: React.ComponentProps<"nav">) => {
  const { text } = useUiText()
  return (
    <nav
      role="navigation"
      aria-label={text("ui.pagination", "Pagination")}
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  )
}
Pagination.displayName = "Pagination"

const PaginationContent = React.forwardRef<
  HTMLUListElement,
  React.ComponentProps<"ul">
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    className={cn("flex flex-row items-center gap-1", className)}
    {...props}
  />
))
PaginationContent.displayName = "PaginationContent"

const PaginationItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentProps<"li">
>(({ className, ...props }, ref) => (
  <li ref={ref} className={cn("", className)} {...props} />
))
PaginationItem.displayName = "PaginationItem"

type PaginationLinkProps = {
  isActive?: boolean
} & Pick<VariantProps<typeof buttonVariants>, "size"> &
  React.ComponentProps<"a">

const PaginationLink = ({
  className,
  isActive,
  size = "icon",
  ...props
}: PaginationLinkProps) => (
  <a
    aria-current={isActive ? "page" : undefined}
    className={cn(
      buttonVariants({
        variant: isActive ? "outline" : "ghost",
        size,
      }),
      className
    )}
    {...props}
  />
)
PaginationLink.displayName = "PaginationLink"

const PaginationPrevious = ({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof PaginationLink>) => {
  const { text } = useUiText()
  return (
    <PaginationLink
      aria-label={text("ui.previousPage", "Go to previous page")}
      size={size}
      className={cn("gap-1 ps-2.5", className)}
      {...props}
    >
      <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
      <span>{text("ui.previous", "Previous")}</span>
    </PaginationLink>
  )
}
PaginationPrevious.displayName = "PaginationPrevious"

const PaginationNext = ({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof PaginationLink>) => {
  const { text } = useUiText()
  return (
    <PaginationLink
      aria-label={text("ui.nextPage", "Go to next page")}
      size={size}
      className={cn("gap-1 pe-2.5", className)}
      {...props}
    >
      <span>{text("ui.next", "Next")}</span>
      <ChevronRight className="h-4 w-4 rtl:rotate-180" />
    </PaginationLink>
  )
}
PaginationNext.displayName = "PaginationNext"

const PaginationEllipsis = ({
  className,
  ...props
}: React.ComponentProps<"span">) => {
  const { text } = useUiText()
  return (
    <span
      aria-hidden
      className={cn("flex h-9 w-9 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontal className="h-4 w-4" />
      <span className="sr-only">{text("ui.morePages", "More pages")}</span>
    </span>
  )
}
PaginationEllipsis.displayName = "PaginationEllipsis"

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}
