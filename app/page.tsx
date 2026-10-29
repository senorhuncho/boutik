import Link from "next/link";

const SHELF = [
  { file: "nido-1plus-0.jpg", name: "Nido 1+", price: "3 500 F" },
  { file: "indomie-super-pack-1.jpg", name: "Indomie Super Pack", price: "300 F" },
  { file: "diapers-softcare-1.jpg", name: "Softcare Mini 2", price: "3 500 F" },
  { file: "sugar-granulated-1.jpg", name: "Sucre 1 kg", price: "900 F" },
  { file: "nan-0.jpg", name: "NAN Comfort 1", price: "7 500 F" },
  { file: "france-lait-0.jpg", name: "France Lait 2", price: "5 500 F" },
];

/** What Boutik is, for anyone who lands on the address. */
export default function Home() {
  return (
    <main className="min-h-dvh">
      <header className="signboard">
        <div className="mx-auto max-w-2xl px-5 pb-8 pt-8">
          <p className="text-[15px] font-bold text-[var(--color-accent)]">Boutik</p>
          <h1 className="mt-3 text-[38px] font-extrabold leading-[1.02] tracking-tight text-white sm:text-[52px]">
            Film your shop.
            <br />
            It&apos;s online in a minute.
          </h1>
          <p className="mt-4 max-w-md text-[17px] leading-relaxed text-white/80">
            Walk along your shelves with your phone and say the prices. Boutik recognises what you sell, counts what is in
            stock, and gives you a link customers order from on WhatsApp.
          </p>
          <Link href="/scan" className="btn btn-whatsapp mt-6 max-w-xs">
            Open my shop
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-2xl px-4 pt-6" aria-label="A shop as Boutik shows it">
        <ul className="grid grid-cols-3 gap-2 sm:gap-3">
          {SHELF.map((p) => (
            <li key={p.file}>
              <div className="relative aspect-square overflow-hidden rounded-2xl bg-[var(--color-wash)]">
                {/* eslint-disable-next-line @next/next/no-img-element -- a real shelf, filmed in Douala */}
                <img src={`/catalog/${p.file}`} alt={p.name} className="h-full w-full object-cover" />
                <span className="tag absolute bottom-1.5 left-1.5 text-[13px] sm:text-[15px]">{p.price}</span>
              </div>
              <p className="mt-1 truncate text-[13px] font-semibold">{p.name}</p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[13px] text-[var(--color-muted)]">Photos cut from a real shop video in Douala. No studio, no typing.</p>
      </section>

      <section className="mx-auto max-w-2xl px-5 pt-12">
        <h2 className="text-2xl font-extrabold">How it works</h2>
        <ol className="mt-4 space-y-5">
          {[
            ["Film the shelves", "One slow walk past your shelves, 20 to 90 seconds, saying each product and its price out loud."],
            ["Check the list", "Boutik names every product, counts the units it can see, and hears your prices. You fix anything with one tap."],
            ["Share the link", "Your shop page and a flyer for WhatsApp Status. Orders arrive in your WhatsApp, written out, with the total."],
          ].map(([title, text], i) => (
            <li key={title} className="flex gap-4">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-[15px] font-extrabold text-[var(--color-accent-ink)]">
                {i + 1}
              </span>
              <div>
                <h3 className="text-[17px] font-bold">{title}</h3>
                <p className="mt-1 text-[15px] leading-relaxed text-[var(--color-muted)]">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-2xl px-5 pt-12">
        <h2 className="text-2xl font-extrabold">It knows the market</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-muted)]">
          Nido, NAN, France Lait, Indomie, Mayor, Softcare, Maggi, Princesse, plantains, pagne: 160 goods common in Cameroon&apos;s
          shops, with how each one looks, how it is sized and how it is counted. Your shop&apos;s own products are remembered
          with their pictures, so the next scan recognises them at a glance and learns from every correction you make.
        </p>
        <Link href="/s/demo-makepe" className="mt-5 inline-block font-bold text-[var(--color-ink)] underline underline-offset-4">
          See a shop
        </Link>
      </section>

      <footer className="mx-auto max-w-2xl px-5 pb-12 pt-14 text-[13px] text-[var(--color-muted)]">
        Built with Meta&apos;s Muse Spark, SAM 3.1 and Muse Voice. A One Market project, Douala.
      </footer>
    </main>
  );
}
