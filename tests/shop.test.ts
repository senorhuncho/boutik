import test from "node:test";
import assert from "node:assert/strict";
import { formatMoney, normalizePhone, orderMessage, slugify, whatsappLink } from "../lib/shop/service.ts";

test("shop addresses are plain and short", () => {
  assert.equal(slugify("Boutique Mama Ngozi"), "boutique-mama-ngozi");
  assert.equal(slugify("Épicerie Chez Élise !!"), "epicerie-chez-elise");
  assert.equal(slugify("   "), "shop");
});

test("Cameroon numbers get the country code; international ones are kept", () => {
  assert.equal(normalizePhone("6 70 12 34 56"), "237670123456");
  assert.equal(normalizePhone("+237 670 12 34 56"), "237670123456");
  assert.equal(normalizePhone("00234 803 123 4567"), "2348031234567");
  assert.equal(normalizePhone("2 22 33 44 55"), "237222334455");
});

test("the order message reads naturally in the shop's language and opens the trader's chat", () => {
  const lines = [
    { name: "Nido 1+ 400 g", qty: 2, price: 3500, unit: "tin" },
    { name: "Indomie Super Pack", qty: 10, price: 300, unit: "sachet" },
  ];
  const fr = orderMessage({ name: "Chez Élise", language: "fr", slug: "chez-elise" }, lines, "0f9a2b3c-1111", { name: "Paul" });
  assert.match(fr, /^Bonjour Chez Élise, je commande :/);
  assert.match(fr, /• 2 × Nido 1\+ 400 g — 7\s000 FCFA/);
  assert.match(fr, /Total : 10\s000 FCFA/);
  assert.match(fr, /Nom : Paul/);
  assert.match(fr, /Commande #0f9a2b3c/);
  const en = orderMessage({ name: "Elise", language: "en", slug: "elise" }, lines, "abcdefgh-2222", {});
  assert.match(en, /^Hello Elise, I'd like to order:/);
  assert.ok(!en.includes("Name:"));
  const link = whatsappLink("237670123456", fr);
  assert.ok(link.startsWith("https://wa.me/237670123456?text=Bonjour%20Chez"));
  assert.match(formatMoney(2500), /^2\s500 FCFA$/);
});
