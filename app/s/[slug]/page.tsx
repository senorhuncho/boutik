import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Storefront } from "@/components/shop/Storefront";
import { publicDb, type ProductRow, type ShopRow } from "@/lib/db/server";

export const dynamic = "force-dynamic";

type PublicShop = Omit<ShopRow, "manage_token">;

async function loadShop(slug: string): Promise<{ shop: PublicShop; products: ProductRow[] } | null> {
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

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadShop(slug);
  if (!data) return { title: "Shop not found" };
  const fr = data.shop.language === "fr";
  return {
    title: data.shop.name,
    description: fr
      ? `${data.products.length} produits en stock chez ${data.shop.name}, ${data.shop.quarter ? data.shop.quarter + ", " : ""}${data.shop.city}. Commandez sur WhatsApp.`
      : `${data.products.length} products in stock at ${data.shop.name}, ${data.shop.quarter ? data.shop.quarter + ", " : ""}${data.shop.city}. Order on WhatsApp.`,
    openGraph: { title: data.shop.name, images: data.products.find((p) => p.image_url)?.image_url ? [data.products.find((p) => p.image_url)?.image_url as string] : [] },
  };
}

/** The shop as buyers see it: what is in stock today, at what price, with a WhatsApp order. */
export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await loadShop(slug);
  if (!data) notFound();
  return <Storefront shop={data.shop} products={data.products} />;
}
