import Link from "next/link";
import type { ReactNode } from "react";

/** The Boutik wordmark: a navy square and the name. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 ${className}`} aria-label="Boutik home">
      <span className="h-[18px] w-[18px] rounded-[5px] bg-[var(--color-ink)]" aria-hidden="true" />
      <span className="text-[17px] font-extrabold tracking-tight text-[var(--color-text)]">Boutik</span>
    </Link>
  );
}

/**
 * The thin top bar every page shares: wordmark or a back link on the left,
 * one action on the right. Content below it sits in a centred column.
 */
export function TopBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-line)] bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4 sm:px-6">
        <div className="min-w-0">{left ?? <Wordmark />}</div>
        <div className="shrink-0">{right}</div>
      </div>
    </header>
  );
}

export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-2xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

/** Steps of the trader's journey, as a quiet line of dots and words. */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 text-[13px]" aria-label="Progress">
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "now" : "next";
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${state === "next" ? "bg-[var(--color-line)]" : "bg-[var(--color-ink)]"}`}
              aria-hidden="true"
            />
            <span className={state === "now" ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-faint)]"}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-[var(--color-bad)] bg-red-50" : tone === "warn" ? "text-[var(--color-warn)] bg-amber-50" : "text-[var(--color-ink)] bg-[var(--color-ink-soft)]";
  return <p className={`rounded-xl px-4 py-3 text-[14px] leading-relaxed ${color}`}>{children}</p>;
}
