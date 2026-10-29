import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Flyer } from "@/components/shop/Flyer";
import { loadPublicShop } from "@/lib/shop/public";

export const metadata: Metadata = { title: "Flyer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function FlyerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await loadPublicShop(slug);
  if (!data) notFound();
  return <Flyer shop={data.shop} products={data.products} />;
}
