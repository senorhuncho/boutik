import Link from "next/link";

/** What Boutik is, for anyone who lands on the address. */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pb-16 pt-10">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">Boutik</p>
      <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight">Film your shop. It&apos;s online in a minute.</h1>
      <p className="mt-4 text-[17px] leading-relaxed text-[var(--color-muted)]">
        Walk along your shelves with your phone and say the prices. Boutik recognises what you sell, counts what is in stock,
        and gives you a shop link to share on WhatsApp. Customers order with one tap, straight into your WhatsApp.
      </p>
      <Link href="/scan" className="mt-8 block w-full rounded-xl bg-[var(--color-ink)] px-5 py-4 text-center text-base font-semibold text-[var(--color-paper)]">
        Open my shop
      </Link>
      <section className="mt-10 space-y-4 text-[15px] leading-relaxed">
        <div>
          <h2 className="font-semibold">It knows the market</h2>
          <p className="text-[var(--color-muted)]">Nido, NAN, Indomie, Mayor, Softcare, Maggi, plantains, pagne: 160 goods common in Cameroon&apos;s shops, learned by look, not just by name.</p>
        </div>
        <div>
          <h2 className="font-semibold">It counts what it sees</h2>
          <p className="text-[var(--color-muted)]">Every pack is followed through the video, so what the shop shows as in stock is what sits on the shelf. You confirm with one tap.</p>
        </div>
        <div>
          <h2 className="font-semibold">It remembers your shop</h2>
          <p className="text-[var(--color-muted)]">The next scan recognises your products from their own pictures and learns from every correction you make.</p>
        </div>
      </section>
      <p className="mt-auto pt-10 text-xs text-[var(--color-muted)]">Built with Meta&apos;s Muse Spark, SAM 3.1 and Muse Voice. A One Market project, Douala.</p>
    </main>
  );
}
