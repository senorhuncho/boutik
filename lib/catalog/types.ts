/**
 * What Boutik knows about the goods usually sold in Cameroon's shops and
 * markets before it has seen a single stall: not only what each product is,
 * but how to recognise it, how to size it, what class of object it is for the
 * detector, and how it is counted. The identifier and the counter read these
 * fields instead of guessing; confirmed scans write what worked back into the
 * shop's memory.
 */
export type Category =
  | "noodles-pasta"
  | "oil"
  | "milk"
  | "baby-food"
  | "sugar-salt"
  | "tinned"
  | "seasoning"
  | "grains-flour"
  | "drinks"
  | "hygiene"
  | "baby-care"
  | "household"
  | "beauty"
  | "vegetables"
  | "fruit"
  | "tubers"
  | "protein"
  | "bakery-snacks"
  | "clothing"
  | "phone"
  | "hardware";

/** How the units of a product are usually counted. */
export type CountBy =
  /** Each unit is one piece: tins, bottles, packs. */
  | "unit"
  /** Sold per heap, basin, cup or bunch; the units inside a heap are not counted. */
  | "heap"
  /** One of a kind pieces (clothes on mannequins, hardware): each visible piece is one. */
  | "piece";

export interface CatalogItem {
  /** Stable id, e.g. "nido-1plus". */
  id: string;
  /** Name as a buyer searches for it. */
  name: string;
  /** Other names: French, Pidgin, loose market names, brand only. Used for matching and voice. */
  names: string[];
  /** Maker printed on the pack, or "" for unbranded goods. */
  brand: string;
  category: Category;

  // Recognise
  /** Printed words, logos, numbers or pictures usually on the pack. */
  marks: string[];
  /** One line on how a unit looks. */
  look: string;
  /** Ids of products it is often confused with. */
  lookAlikes: string[];
  /** What tells it from its look-alikes, in one sentence. */
  tellApart: string;

  // Size
  /** Sizes it is commonly sold in, as printed ("400 g", "1 L"). */
  sizes: string[];
  /** How to tell the sizes apart in a photo (printed weight, height next to a neighbour). */
  sizeCue: string;

  // Class
  /** Plain shape word for one unit, for SAM 3.1 ("tin", "package"). */
  shape: string;
  /** Second shape word tried when the first finds little. */
  fallback: string;
  /** Soft pack (sachet, bag): the detector needs "package" as well. */
  soft: boolean;
  /** The selling unit: tin, bottle, pack, heap, bunch, piece... */
  unit: string;
  /** How shops usually display it. */
  display: string;

  // Count
  countBy: CountBy;
  /** Traps and tips for counting this product. */
  countNotes: string;

  /** Typical price range in FCFA for one selling unit (Douala, 2026, approximate). */
  price?: [number, number];
}

export interface CatalogPicture {
  /** Catalogue item id. */
  item: string;
  /** Path under /catalog/ (public folder). */
  file: string;
  /** Where the picture came from: a seed scan or a trader's confirmed scan. */
  source: string;
}
