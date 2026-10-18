"use client";

import { forwardRef } from "react";

type Variant = "primary" | "ghost" | "subtle" | "danger";

const styles: Record<Variant, string> = {
  primary: "bg-accent text-white hover:brightness-110 disabled:opacity-40",
  ghost: "text-muted hover:text-fg hover:bg-raised disabled:opacity-30",
  subtle: "bg-raised text-fg border border-line hover:border-faint disabled:opacity-40",
  danger: "text-danger hover:bg-danger/10",
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }
>(function Button({ variant = "subtle", size = "md", className = "", ...rest }, ref) {
  const pad = size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm";
  return (
    <button
      ref={ref}
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${pad} ${styles[variant]} ${className}`}
      {...rest}
    />
  );
});

export function IconButton({
  label,
  className = "",
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full sm:h-10 sm:w-10 text-muted transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-30 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
