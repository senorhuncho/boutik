import Link from "next/link";
import { Page, TopBar, Wordmark } from "@/components/ui/Shell";

const SHELF = [
  { file: "nido-1plus-0.jpg", name: "Nido 1+ 400 g", price: "3 500 FCFA" },
  { file: "nan-0.jpg", name: "NAN Comfort 1", price: "7 500 FCFA" },
  { file: "indomie-super-pack-1.jpg", name: "Indomie Super Pack", price: "300 FCFA" },
  { file: "diapers-softcare-1.jpg", name: "Softcare Mini 2", price: "3 500 FCFA" },
  { file: "sugar-granulated-1.jpg", name: "Sucre 1 kg", price: "900 FCFA" },
  { file: "france-lait-0.jpg", name: "France Lait 2", price: "5 500 FCFA" },
];

/** What Boutik is, for anyone who lands on the address. */
export default function Home() {
  return (
    <main className="min-h-dvh">
      <TopBar
        right={
          <Link href="/scan" className="btn btn-primary btn-sm">
            Open my shop
          </Link>
        }
      />
      <Page>
        <section className="pb-12 pt-14 sm:pt-20">
          <h1 className="max-w-[16ch] text-[40px] leading-[1.02] sm:text-[56px]">Film your shelves. Your shop is online.</h1>
          <p className="mt-6 max-w-[46ch] text-[17px] leading-relaxed text-[var(--color-muted)] sm:text-[19px]">
            Walk past your shelves with your phone and say the prices. Boutik recognises the products, counts the stock
            and gives you a page customers order from on WhatsApp.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/scan" className="btn btn-primary sm:w-auto sm:px-7">
              Open my shop
            </Link>
            <Link href="/s/demo-makepe" className="btn btn-secondary sm:w-auto sm:px-7">
              See a shop
            </Link>
          </div>
        </section>

        <section aria-label="A shop as Boutik shows it" className="pb-16">
          <ul className="grid grid-cols-3 gap-3 sm:gap-4">
            {SHELF.map((p) => (
              <li key={p.file}>
                <div className="aspect-square overflow-hidden rounded-xl bg-[var(--color-surface)]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a real shelf, filmed in Douala */}
                  <img src={`/catalog/${p.file}`} alt={p.name} className="h-full w-full object-cover" />
                </div>
                <p className="mt-2 truncate text-[13px] font-semibold sm:text-[15px]">{p.name}</p>
                <p className="text-[13px] font-bold text-[var(--color-ink)] sm:text-[15px]">{p.price}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[13px] text-[var(--color-muted)]">Photos cut from one shop video in Douala. No studio, no typing.</p>
        </section>

        <section className="border-t border-[var(--color-line)] py-14">
          <h2 className="text-[28px]">How it works</h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-3">
            {[
              ["Film", "One slow walk past the shelves, 20 to 90 seconds, saying each product and its price out loud."],
              ["Check", "Boutik names every product, counts the units it can see and hears the prices. You fix anything with one tap."],
              ["Share", "A shop page and flyers for WhatsApp Status. Orders arrive in your WhatsApp, written out, with the total."],
            ].map(([title, text], i) => (
              <li key={title}>
                <p className="text-[13px] font-semibold text-[var(--color-faint)]">0{i + 1}</p>
                <h3 className="mt-2 text-[19px]">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[var(--color-muted)]">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-[var(--color-line)] py-14">
          <h2 className="text-[28px]">It knows the market</h2>
          <p className="mt-4 max-w-[60ch] text-[16px] leading-relaxed text-[var(--color-muted)]">
            160 goods common in Cameroon&apos;s shops, from Nido and Indomie to plantains and pagne, each with how it looks, how it
            is sized and how it is counted. Your own products are remembered with their pictures, so every scan starts from what
            the last one learned.
          </p>
        </section>

        <footer className="flex flex-col gap-3 border-t border-[var(--color-line)] py-10 text-[13px] text-[var(--color-muted)] sm:flex-row sm:items-center sm:justify-between">
          <Wordmark />
          <p>Built on Meta&apos;s Muse Spark, SAM 3.1 and Muse Voice. A One Market project, Douala.</p>
        </footer>
      </Page>
    </main>
  );
}
