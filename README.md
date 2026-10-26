# Boutik

From market stall to online shop in a minute.

Millions of traders in Cameroon sell from market stalls with no catalogue, no stock records and no online
presence, because typing listings one product at a time is too slow. With Boutik, a trader films the stall
for a few seconds while saying the prices out loud, and gets back a product list with counts and prices,
ready to become a shop that takes orders on WhatsApp.

Built for the Meta Global AI Developer Hackathon (October 26 – November 4, 2026).

## How a scan works

1. **On the phone:** the browser splits the video into segments, keeps the sharpest frame from each
   (variance of the Laplacian), and converts the sound track to 16 kHz mono WAV. A 30 MB video becomes
   about 1 MB of upload, which matters on mobile data.
2. **Muse Spark** reads the frames and lists every product: name, brand, selling unit, an estimated count,
   the frame where it is most visible, and words a trader might use for it.
3. **Muse Voice Transcribe** listens for prices, biased with the product names Spark just saw. Muse Spark
   also listens to the same audio as a second opinion for Pidgin, then matches spoken prices to products.
4. **SAM 3.1** segments every unit of each product on its best frame and returns a mask and confidence
   for each one, which gives the count.

The scan lab at `/lab` shows each step, draws SAM's masks on the frames, compares Muse Spark's count with
SAM's against a hand count, and exports the results as JSON.

## Run it

```bash
npm install
cp .env.example .env.local   # add MODEL_API_KEY
npm run dev
```

| Variable | Purpose |
| --- | --- |
| `MODEL_API_KEY` | Meta Model API key (dev.meta.ai) |
| `SELFTEST_KEY` | Enables `/api/selftest?key=...`, which calls every model once end to end |

```bash
npm test          # unit tests
npm run typecheck
npm run build
```

## Stack

Next.js, TypeScript, Tailwind CSS, Vercel. Meta Model API: `muse-spark-1.3`, `muse-spark-1.2` (audio),
`muse-voice-transcribe-1.0`, `sam-3.1`, `muse-image-1.0`. SAM output is decoded with Meta's
`@meta-sam/parser`.
