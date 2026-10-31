/**
 * What a trader can say to Boutik on WhatsApp, read without a model so it is
 * instant and free: open a shop, send a video, change a stock or a price,
 * ask for the link. Pure functions; the handler does the database work.
 */

export type Command =
  | { kind: "open"; name: string; language: "fr" | "en" }
  | { kind: "link" }
  | { kind: "stock"; product: string; value: number }
  | { kind: "price"; product: string; value: number }
  | { kind: "list" }
  | { kind: "orders" }
  | { kind: "delivered"; ref?: string }
  | { kind: "help" };

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function looksEnglish(text: string): boolean {
  return /\b(shop|store|my|the|open|price|stock|link|list|help)\b/i.test(text) && !/\b(boutique|prix|lien|liste|aide|ma|mon)\b/i.test(text);
}

export function parseCommand(raw: string): Command {
  const text = clean(raw);
  const lower = text.toLowerCase();

  const open = /^(?:boutique|shop|store|ouvrir|open)\s*[:\-]?\s+(.{2,60})$/i.exec(text);
  if (open) return { kind: "open", name: open[1]!.trim(), language: looksEnglish(text) ? "en" : "fr" };

  if (/^(lien|link|url|ma boutique|my shop|boutique|shop)\s*\??$/i.test(lower)) return { kind: "link" };
  if (/^(liste|list|stock|produits|products|inventaire|inventory)\s*\??$/i.test(lower)) return { kind: "list" };
  if (/^(commandes?|orders?)\s*\??$/i.test(lower)) return { kind: "orders" };
  const delivered = /^(?:livr[ée]e?s?|delivered|done|ok)\s*#?\s*([0-9a-f]{4,8})?\s*$/i.exec(text);
  if (delivered) return { kind: "delivered", ref: delivered[1]?.toLowerCase() };
  if (/^(aide|help|\?|menu|bonjour|hello|hi|salut)\s*!?$/i.test(lower)) return { kind: "help" };

  // "stock Nido 7", "prix Nido 3500", "Nido stock 7", "Nido 3500 f".
  const explicit = /^(?:(stock|prix|price)\s+)?(.+?)\s+(?:(stock|prix|price)\s+)?(\d[\d\s.,]*)\s*(?:f|fcfa|francs?|cfa)?\s*$/i.exec(text);
  if (explicit) {
    const word = (explicit[1] ?? explicit[3] ?? "").toLowerCase();
    const product = explicit[2]!.trim();
    const value = Number(explicit[4]!.replace(/[\s.,]/g, ""));
    if (product && Number.isFinite(value)) {
      if (word === "stock") return { kind: "stock", product, value };
      if (word === "prix" || word === "price") return { kind: "price", product, value };
      // No word: a small number is a count, a large one is a price in francs.
      return value >= 100 ? { kind: "price", product, value } : { kind: "stock", product, value };
    }
  }
  return { kind: "help" };
}

/** The product whose name best contains the words the trader typed, or null when nothing fits. */
export function pickProduct<T extends { name: string; brand: string }>(products: readonly T[], query: string): T | null {
  const q = fold(query);
  if (!q) return null;
  const words = q.split(" ").filter(Boolean);
  let best: { p: T; score: number } | null = null;
  for (const p of products) {
    const hay = fold(`${p.name} ${p.brand}`);
    let score = 0;
    if (hay.includes(q)) score += 10;
    for (const w of words) if (hay.includes(w)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { p, score };
  }
  return best?.p ?? null;
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();
}

export const SAY = {
  fr: {
    welcome: "Bienvenue sur Boutik. Pour ouvrir votre boutique, envoyez :\nBoutique <nom de votre boutique>\n\nEnsuite, filmez vos rayons en disant les prix et envoyez la vidéo ici.",
    opened: (name: string) => `Boutique « ${name} » ouverte. Filmez vos rayons lentement (moins de 90 secondes) en disant chaque produit et son prix, puis envoyez la vidéo ici.`,
    videoReceived: (link: string) => `Vidéo reçue. Boutik regarde vos rayons. Ouvrez ce lien pour vérifier la liste et mettre la boutique en ligne :\n${link}`,
    videoTooBig: "La vidéo est trop lourde pour WhatsApp (16 Mo). Filmez moins de 90 secondes, ou ouvrez le lien de votre boutique pour la charger directement.",
    notVideo: "Envoyez une vidéo de vos rayons (pas une photo), ou un message comme « Nido 7 » pour changer un stock.",
    link: (link: string) => `Votre boutique : ${link}`,
    noShop: "Vous n'avez pas encore de boutique. Envoyez :\nBoutique <nom de votre boutique>",
    noProducts: "Votre boutique n'a pas encore de produits. Envoyez une vidéo de vos rayons.",
    list: (lines: string[]) => `En rayon :\n${lines.join("\n")}`,
    noMatch: (q: string) => `Je ne trouve pas « ${q} » dans votre boutique. Envoyez « liste » pour voir les produits.`,
    stockSet: (name: string, n: number) => `${name} : ${n} en stock.`,
    priceSet: (name: string, n: string) => `${name} : ${n}.`,
    online: (n: number, link: string) => `Votre boutique est en ligne avec ${n} produit${n > 1 ? "s" : ""}.\n${link}\n\nPartagez ce lien à vos clients. Pour changer un stock : « Nido 7 ». Un prix : « Nido 3500 ».`,
    help: "Ce que vous pouvez envoyer ici :\n• une vidéo de vos rayons — Boutik met la boutique à jour\n• un vocal : « Nido il en reste 7, le sucre c'est 900 »\n• « Nido 7 » — stock de Nido à 7\n• « Nido 3500 » — prix de Nido à 3 500 F\n• « livré af03 » — commande livrée, le stock se met à jour\n• « commandes » — vos commandes en attente\n• « liste » — vos produits\n• « lien » — le lien de votre boutique",
    noOrders: "Aucune commande en attente.",
    orders: (lines: string[]) => `Commandes en attente :\n${lines.join("\n")}\n\nRépondez « livré <numéro> » quand c'est livré.`,
    noSuchOrder: "Je ne trouve pas cette commande parmi celles en attente. Envoyez « commandes ».",
    delivered: (ref: string, lines: string[]) => `Commande #${ref} livrée. Stock mis à jour :\n${lines.join("\n")}`,
    heard: (text: string) => `J'ai entendu : « ${text} »`,
    notUnderstood: "Je n'ai pas compris. Dites par exemple : « Nido il en reste 7 » ou « le sucre c'est 900 francs ».",
    customerHello: (shop: string, n: number) => `Bonjour, ici Boutik pour ${shop}. ${n} produit${n > 1 ? "s" : ""} en rayon aujourd'hui. Demandez-moi un produit ou un prix, par exemple « tu as du Nido ? c'est combien ? », ou passez commande : « je prends 2 Nido ».`,
    customerOrdered: (ref: string, phone: string) => `Commande #${ref} enregistrée. Le vendeur vous écrit sur WhatsApp pour la livraison : wa.me/${phone}`,
    customerFailed: (phone: string) => `Je n'arrive pas à répondre pour l'instant. Écrivez directement au vendeur : wa.me/${phone}`,
    customerTextOnly: "Écrivez-moi votre question en texte, par exemple « tu as du Nido ? c'est combien ? ».",
    newOrder: (ref: string, lines: string[], total: string, phone: string) => `Nouvelle commande #${ref} par WhatsApp :\n${lines.join("\n")}\nTotal : ${total}\nClient : wa.me/${phone}\n\nRépondez « livré ${ref.slice(0, 4)} » quand c'est livré ; le stock se met à jour.`,
  },
  en: {
    welcome: "Welcome to Boutik. To open your shop, send:\nShop <your shop name>\n\nThen film your shelves saying the prices and send the video here.",
    opened: (name: string) => `Shop “${name}” is open. Film your shelves slowly (under 90 seconds) saying each product and its price, then send the video here.`,
    videoReceived: (link: string) => `Video received. Boutik is looking at your shelves. Open this link to check the list and put the shop online:\n${link}`,
    videoTooBig: "The video is too large for WhatsApp (16 MB). Film under 90 seconds, or open your shop link to upload it directly.",
    notVideo: "Send a video of your shelves (not a photo), or a message like “Nido 7” to change a stock.",
    link: (link: string) => `Your shop: ${link}`,
    noShop: "You have no shop yet. Send:\nShop <your shop name>",
    noProducts: "Your shop has no products yet. Send a video of your shelves.",
    list: (lines: string[]) => `On the shelf:\n${lines.join("\n")}`,
    noMatch: (q: string) => `I can't find “${q}” in your shop. Send “list” to see the products.`,
    stockSet: (name: string, n: number) => `${name}: ${n} in stock.`,
    priceSet: (name: string, n: string) => `${name}: ${n}.`,
    online: (n: number, link: string) => `Your shop is online with ${n} product${n === 1 ? "" : "s"}.\n${link}\n\nShare this link with your customers. To change a stock: “Nido 7”. A price: “Nido 3500”.`,
    help: "What you can send here:\n• a video of your shelves — Boutik updates the shop\n• a voice note: “Nido, 7 left, sugar is 900”\n• “Nido 7” — Nido stock to 7\n• “Nido 3500” — Nido price to 3,500 F\n• “delivered af03” — order delivered, stock updates\n• “orders” — your open orders\n• “list” — your products\n• “link” — your shop link",
    noOrders: "No open orders.",
    orders: (lines: string[]) => `Open orders:\n${lines.join("\n")}\n\nReply “delivered <number>” once it is delivered.`,
    noSuchOrder: "I can't find that order among the open ones. Send “orders”.",
    delivered: (ref: string, lines: string[]) => `Order #${ref} delivered. Stock updated:\n${lines.join("\n")}`,
    heard: (text: string) => `I heard: “${text}”`,
    notUnderstood: "I didn't get that. Say for example: “Nido, 7 left” or “sugar is 900 francs”.",
    customerHello: (shop: string, n: number) => `Hello, this is Boutik for ${shop}. ${n} product${n === 1 ? "" : "s"} on the shelf today. Ask me about a product or a price, like “do you have Nido? how much?”, or order: “I'll take 2 Nido”.`,
    customerOrdered: (ref: string, phone: string) => `Order #${ref} placed. The seller will message you on WhatsApp about delivery: wa.me/${phone}`,
    customerFailed: (phone: string) => `I can't answer right now. Message the seller directly: wa.me/${phone}`,
    customerTextOnly: "Send me your question as text, for example “do you have Nido? how much?”.",
    newOrder: (ref: string, lines: string[], total: string, phone: string) => `New order #${ref} over WhatsApp:\n${lines.join("\n")}\nTotal: ${total}\nBuyer: wa.me/${phone}\n\nReply “delivered ${ref.slice(0, 4)}” once it is delivered; stock updates.`,
  },
} as const;
