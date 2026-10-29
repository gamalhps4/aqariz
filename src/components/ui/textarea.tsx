import * as React from "react";

import { cn } from "@/lib/utils";

interface TextareaProps extends React.ComponentProps<"textarea"> {
  error?: string;
}

function Textarea({ className, error, ...props }: TextareaProps) {
  return (
    <div className="space-y-1">
      <textarea
        data-slot="textarea"
        className={cn(
          "placeholder:text-muted-foreground",
          "flex min-h-16 w-full rounded-md border-2 border-gray-200 bg-white px-3 py-2 text-sm",
          "shadow-sm transition-all duration-200 outline-none resize-y",
          "hover:border-gray-300 hover:shadow-md",
          "focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:shadow-lg",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-gray-50",
          "dark:border-gray-700 dark:bg-gray-800/50 dark:hover:border-gray-600 dark:focus:border-blue-400 dark:focus:ring-blue-400/20",
          error && "border-red-500 focus:border-red-500 focus:ring-red-500/20",
          className
        )}
        aria-invalid={!!error}
        {...props}
      />
      {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
    </div>
  );
}

export { Textarea };
