import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Opus decoder loads WebAssembly and a worker shim at runtime; bundling it breaks the import.
  serverExternalPackages: ["ogg-opus-decoder", "opus-decoder", "@wasm-audio-decoders/common", "@eshaz/web-worker"],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
