"use client";

import { useState } from "react";

export function Unlock({ title = "Scan lab" }: { title?: string }) {
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
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5">
      <p className="text-[14px] font-bold text-[var(--color-ink)]">Boutik</p>
      <h1 className="mt-1 text-[28px] font-extrabold">{title}</h1>
      <p className="mt-2 text-[15px] text-[var(--color-muted)]">Boutik is open to a few shops for now. Enter the code you were given.</p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <label className="block text-sm font-medium" htmlFor="passcode">
          Invite code
        </label>
        <input
          id="passcode"
          type="password"
          autoComplete="current-password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          className="field"
        />
        {error ? <p className="text-sm text-[var(--color-bad)]">{error}</p> : null}
        <button
          type="submit"
          disabled={busy || passcode.trim() === ""}
          className="btn btn-ink"
        >
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    </main>
  );
}
