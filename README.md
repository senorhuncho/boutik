# Boutik

Film your shelves. Your shop is online.

Boutik turns a one-minute phone video of a shop into a live storefront. A trader in Douala walks past the shelves saying the prices; Boutik recognises the products, counts the units it can see, hears the prices, and publishes a page customers order from on WhatsApp, with flyers for WhatsApp Status. No typing, no product photos to take, no catalogue to fill in.

Built for the Meta Global AI Developer Hackathon (Startup track, "Build for Your World") by One Market SARL, Douala, Cameroon.

## What it does

1. **Film.** The trader films the shelves (20 to 90 seconds) and says each product and price out loud. Everything heavy happens on the phone: sharp keyframes, a 16 kHz audio track and a small tracking clip are made in the browser, so only a few megabytes go over mobile data.
2. **Recognise.** Muse Spark names every product from the frames, reading packaging like a shopkeeper: printed words, logos, colours, size next to neighbours. It is shown reference sheets of goods Boutik already knows (real photos cut from other stalls, plus the shop's own remembered products), so a blurry tin is still recognised by look.
3. **Count.** SAM 3.1 finds every unit. Small groups are tracked through the whole clip so a tin seen twice counts once; big piles are counted per frame, keeping the most seen at once per place. Muse Spark sorts look-alikes from close-ups and rejects units that belong to the stall behind. Cut-off slivers at the picture's edge, box tops and hidden rows are handled by rules learned from real shop videos.
4. **Hear.** Muse Voice Transcribe (biased with the product names) and Muse Spark audio both listen; Spark matches each spoken price to a product, in French, English or Pidgin. Prices that cannot be right are flagged, never published unconfirmed.
5. **Check.** The trader sees the list with photos cut from their own video, fixes a count or a price with one tap, removes what is not for sale, and publishes.
6. **Sell.** A shop page (`/s/<shop>`) with search and sections, a basket that opens WhatsApp with the order written out, and Status flyers (six products per slide, numbered) drawn on the phone from the shop's own photos.
7. **Remember.** The shop keeps its products and pictures; the next scan starts from them. Every correction is recorded, and after a pattern of corrections the stock suggestion for that product changes.

## The market catalogue

`lib/catalog/cameroon.ts` holds 160 goods common in Cameroon's shops and markets, each with the know-how a shopkeeper has: names in English, French and market words; brand and printed marks; what tells it from its look-alikes; the sizes it comes in and the cue that separates them; the shape word the detector understands; how it is displayed and how it is counted (per unit, per heap, per piece); a usual price range. Fifty-five pictures cut from real stall videos are shown to the identifier as numbered reference sheets. Matching (`lib/catalog/match.ts`) prefers a written brand and a two-word name over a lone generic word, so a branded pack is never pulled onto a brand it does not carry.

## Meta models used

| Model | Role |
| --- | --- |
| Muse Spark 1.3 | Product identification with reference sheets; sorting look-alikes from close-ups; verifying detections; matching spoken prices |
| SAM 3.1 | Video tracking of units through the clip; image detection per keyframe |
| Muse Voice Transcribe | Transcription of the trader's prices, biased with product names |
| Muse Spark 1.2 (audio) | Second transcript, for disagreement checks |

All calls go through the Meta Model API (`https://api.meta.ai/v1`) with the OpenAI SDK.

## Stack

Next.js 16 (App Router) on Vercel, React 19, TypeScript, Tailwind 4, Supabase (Postgres, Storage, row security). Media work in the browser: canvas, WebCodecs and Mediabunny for the tracking clip, Web Audio for the WAV, Web Share for the flyers.

## Running it

```
npm install
npm run dev
```

Environment variables: `MODEL_API_KEY` (Meta Model API), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `LAB_PASSCODE` (invite code for `/scan` and the internal `/lab` test bench during the pilot). Apply `supabase/migrations/001_boutik.sql` to a Supabase project.

```
npm test        # unit tests and offline replays of real scans
npm run typecheck
```

## Layout

- `app/scan` the trader's flow; `app/s/[slug]` the shop, its flyer and its manage page; `app/lab` the internal test bench with accuracy measurement.
- `app/api/scan/*` identify, count, track, assign, prices. `app/api/shop/*` shops, scans, products, memory, orders.
- `components/scan/useScan.ts` the scan pipeline on the phone, shared by the shop and the lab. `components/lab/counting.ts` counting methods and filters.
- `lib/catalog` the market catalogue, matching and pictures. `lib/scan` normalisation, grouping, tracks, panorama, accuracy. `lib/media` keyframes, audio, clip, crops. `lib/shop` drafts, service, public reads.
- `tests` unit tests, including replays of saved real scans (`tests/fixtures`).

## Licence

MIT.
