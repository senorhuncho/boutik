import { publicDb, type ProductRow, type ShopRow } from "../db/server";

export type PublicShop = Omit<ShopRow, "manage_token">;

/** A shop and its published products, read with the public key. */
export async function loadPublicShop(slug: string): Promise<{ shop: PublicShop; products: ProductRow[] } | null> {
  const client = publicDb();
  if (!client) return null;
  const { data: shop } = await client.from("boutik_shops_public").select("*").eq("slug", slug).maybeSingle();
  if (!shop) return null;
  const { data: products } = await client
    .from("boutik_products")
    .select("*")
    .eq("shop_id", shop.id)
    .eq("published", true)
    .order("sort")
    .order("created_at");
  return { shop: shop as PublicShop, products: (products ?? []) as ProductRow[] };
}
