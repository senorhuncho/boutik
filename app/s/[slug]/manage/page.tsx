import type { Metadata } from "next";
import { Manage } from "@/components/shop/Manage";

export const metadata: Metadata = { title: "Manage your shop", robots: { index: false, follow: false } };

export default async function ManagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Manage slug={slug} />;
}
