import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand, pickProduct } from "../lib/whatsapp/commands.ts";
import { inboundMessages, signatureValid } from "../lib/whatsapp/client.ts";

test("a trader's messages become commands", () => {
  assert.deepEqual(parseCommand("Boutique Chez Élise"), { kind: "open", name: "Chez Élise", language: "fr" });
  assert.deepEqual(parseCommand("shop Mama Ngozi Store"), { kind: "open", name: "Mama Ngozi Store", language: "en" });
  assert.deepEqual(parseCommand("Nido 7"), { kind: "stock", product: "Nido", value: 7 });
  assert.deepEqual(parseCommand("Nido 3500"), { kind: "price", product: "Nido", value: 3500 });
  assert.deepEqual(parseCommand("Nido 1+ 3 500 F"), { kind: "price", product: "Nido 1+", value: 3500 });
  assert.deepEqual(parseCommand("stock indomie 120"), { kind: "stock", product: "indomie", value: 120 }, "the word stock wins over the size of the number");
  assert.deepEqual(parseCommand("prix sucre 900"), { kind: "price", product: "sucre", value: 900 });
  assert.deepEqual(parseCommand("Indomie stock 40"), { kind: "stock", product: "Indomie", value: 40 });
  assert.deepEqual(parseCommand("lien"), { kind: "link" });
  assert.deepEqual(parseCommand("Liste"), { kind: "list" });
  assert.deepEqual(parseCommand("Bonjour"), { kind: "help" });
  assert.deepEqual(parseCommand("je veux quelque chose"), { kind: "help" });
});

test("the product is found from a few of its words", () => {
  const products = [
    { name: "Nido 1+ 400 g", brand: "Nestlé" },
    { name: "NAN Comfort 1", brand: "Nestlé" },
    { name: "Indomie Super Pack", brand: "Indomie" },
  ];
  assert.equal(pickProduct(products, "nido")?.name, "Nido 1+ 400 g");
  assert.equal(pickProduct(products, "super pack")?.name, "Indomie Super Pack");
  assert.equal(pickProduct(products, "nan")?.name, "NAN Comfort 1");
  assert.equal(pickProduct(products, "sucre"), null);
});

test("webhook payloads are read and signed", () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: "237670000000", profile: { name: "Jason" } }],
              messages: [
                { id: "wamid.1", from: "237670000000", type: "text", text: { body: "Nido 7" } },
                { id: "wamid.2", from: "237670000000", type: "video", video: { id: "media1", mime_type: "video/mp4" } },
              ],
            },
          },
          { value: { statuses: [{ id: "x", status: "delivered" }] } },
        ],
      },
    ],
  };
  const messages = inboundMessages(payload);
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.text, "Nido 7");
  assert.equal(messages[0]?.name, "Jason");
  assert.equal(messages[1]?.media?.id, "media1");
  assert.equal(signatureValid("{}", null), true, "no app secret configured: accepted");
  process.env.WHATSAPP_APP_SECRET = "s3cret";
  assert.equal(signatureValid("{}", "sha256=bad"), false);
  assert.equal(signatureValid("{}", "sha256=" + "4b7f3b1e6e2a4e8c4a6a2f0b7a3f9b1c0e5b1e3f2a6c8d9e0f1a2b3c4d5e6f70"), false);
  delete process.env.WHATSAPP_APP_SECRET;
});

import { isOpener, shopSlugIn } from "../lib/whatsapp/customer.ts";

test("a buyer's first message names the shop by link or tag, never by shop name", () => {
  assert.equal(shopSlugIn("Bonjour, je suis sur la boutique Chez Mama https://boutik-pi.vercel.app/s/chez-mama"), "chez-mama");
  assert.equal(shopSlugIn("#demo-makepe tu as du Nido ?"), "demo-makepe");
  assert.equal(shopSlugIn("Boutique Chez Mama"), null);
  assert.equal(shopSlugIn("Nido 7"), null);
});

test("the pre-filled opener is told apart from a real question", () => {
  assert.equal(isOpener("Bonjour, je suis sur la boutique Chez Mama https://boutik-pi.vercel.app/s/chez-mama"), true);
  assert.equal(isOpener("Hello, I am on the shop Demo Makepe https://boutik-pi.vercel.app/s/demo-makepe"), true);
  assert.equal(isOpener("Bonjour https://boutik-pi.vercel.app/s/chez-mama tu as du Nido ? c'est combien"), false);
  assert.equal(isOpener("#chez-mama je prends 2 Nido"), false);
});
