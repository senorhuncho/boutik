import type { Metadata } from "next";
import { Orders } from "@/components/shop/Orders";

export const metadata: Metadata = { title: "Orders", robots: { index: false, follow: false } };

export default async function OrdersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Orders slug={slug} />;
}
