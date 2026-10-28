import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase on the server. The secret key writes shops, scans, products and
 * the picture memory; the publishable key reads what the public may see.
 * Keys live only in environment variables.
 */

export const BUCKET = "boutik";

function url(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) throw new MemoryUnavailable("Supabase URL is not configured.");
  return value;
}

export class MemoryUnavailable extends Error {}

let service: SupabaseClient | null = null;
let anon: SupabaseClient | null = null;

/** Full access. Throws MemoryUnavailable when the secret key is missing. */
export function db(): SupabaseClient {
  if (service) return service;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new MemoryUnavailable("The shop memory is not set up yet (SUPABASE_SECRET_KEY is missing).");
  service = createClient(url(), key, { auth: { persistSession: false, autoRefreshToken: false } });
  return service;
}

/** Public reads only. */
export function publicDb(): SupabaseClient | null {
  if (anon) return anon;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key || !base) return null;
  anon = createClient(base, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return anon;
}

export function memoryConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function publicUrl(path: string): string {
  return `${url()}/storage/v1/object/public/${BUCKET}/${path}`;
}

export interface ShopRow {
  id: string;
  slug: string;
  name: string;
  whatsapp: string;
  city: string;
  quarter: string;
  language: "fr" | "en";
  manage_token?: string;
  created_at: string;
}

export interface ProductRow {
  id: string;
  shop_id: string;
  catalog_id: string | null;
  name: string;
  brand: string;
  unit: string;
  description: string;
  image_url: string | null;
  stock: number;
  stock_hint: number | null;
  price: number | null;
  currency: string;
  price_per: string;
  published: boolean;
  needs_check: string[];
  sort: number;
  last_scan_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderRow {
  id: string;
  shop_id: string;
  items: { productId: string; name: string; qty: number; price: number }[];
  total: number;
  currency: string;
  buyer_name: string;
  buyer_phone: string;
  note: string;
  status: string;
  created_at: string;
}
