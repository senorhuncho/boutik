"use client";

import { useState } from "react";
import { Notice, Page, TopBar } from "@/components/ui/Shell";

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
    setError(res ? "That code is not right." : "No connection. Try again.");
  }

  return (
    <main className="min-h-dvh">
      <TopBar />
      <Page className="max-w-md pt-12">
        <h1 className="text-[28px]">{title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[var(--color-muted)]">Boutik is open to a few shops for now. Enter the code you were given.</p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <div>
            <label className="label" htmlFor="passcode">
              Invite code
            </label>
            <input id="passcode" type="password" autoComplete="current-password" value={passcode} onChange={(e) => setPasscode(e.target.value)} className="field" />
          </div>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <button type="submit" disabled={busy || passcode.trim() === ""} className="btn btn-primary">
            {busy ? "Checking…" : "Continue"}
          </button>
        </form>
      </Page>
    </main>
  );
}
