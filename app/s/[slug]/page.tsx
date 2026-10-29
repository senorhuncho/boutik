import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Storefront } from "@/components/shop/Storefront";
import { loadPublicShop } from "@/lib/shop/public";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadPublicShop(slug);
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
  const data = await loadPublicShop(slug);
  if (!data) notFound();
  return <Storefront shop={data.shop} products={data.products} />;
}
