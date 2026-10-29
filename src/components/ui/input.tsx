import * as React from "react";

import { cn } from "@/lib/utils";

interface InputProps extends React.ComponentProps<"input"> {
  error?: string;
}

function Input({ className, type, error, ...props }: InputProps) {
  return (
    <div className="space-y-1">
      <input
        type={type}
        data-slot="input"
        className={cn(
          "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground",
          "flex h-10 w-full min-w-0 rounded-md border-2 border-gray-200 bg-white px-3 py-2 text-sm",
          "shadow-sm transition-all duration-200 outline-none",
          "hover:border-gray-300 hover:shadow-md",
          "focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:shadow-lg",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-gray-50",
          "dark:border-gray-700 dark:bg-gray-800/50 dark:hover:border-gray-600 dark:focus:border-blue-400 dark:focus:ring-blue-400/20",
          "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
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

export { Input };
