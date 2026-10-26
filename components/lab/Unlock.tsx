"use client";

import { useState } from "react";

export function Unlock() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/lab/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    }).catch(() => null);
    if (res?.ok) {
      window.location.reload();
      return;
    }
    setBusy(false);
    setError(res ? "Wrong passcode." : "No connection. Try again.");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">Boutik</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Scan lab</h1>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <label className="block text-sm font-medium" htmlFor="passcode">
          Passcode
        </label>
        <input
          id="passcode"
          type="password"
          autoComplete="current-password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-3.5 text-base outline-none focus:border-[var(--color-ink)]"
        />
        {error ? <p className="text-sm text-[var(--color-bad)]">{error}</p> : null}
        <button
          type="submit"
          disabled={busy || passcode.trim() === ""}
          className="w-full rounded-xl bg-[var(--color-ink)] px-5 py-3.5 text-base font-semibold text-[var(--color-paper)] disabled:opacity-40"
        >
          {busy ? "Checking…" : "Open the lab"}
        </button>
      </form>
    </main>
  );
}
