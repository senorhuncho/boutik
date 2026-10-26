"use client";

import type { Detection } from "@/lib/scan/types";

interface Props {
  src: string;
  width: number;
  height: number;
  detections: readonly Detection[];
  threshold: number;
  alt: string;
}

/** A stall frame with SAM's masks and boxes drawn on top, numbered. */
export function FrameOverlay({ src, width, height, detections, threshold, alt }: Props) {
  const shown = detections.filter((d) => d.confidence === null || d.confidence >= threshold);
  const hidden = detections.length - shown.length;
  const stroke = Math.max(2, Math.round(Math.max(width, height) / 400));
  const font = Math.max(14, Math.round(Math.max(width, height) / 45));

  return (
    <figure className="relative overflow-hidden rounded-xl bg-black/5">
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
      <img src={src} alt={alt} width={width} height={height} className="block h-auto w-full" />
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {shown.map((d, i) => {
          const b = d.box;
          const m = d.maskBounds;
          const s = d.maskSize;
          return (
            <g key={d.id}>
              {d.maskPath && m && s ? (
                <path
                  d={d.maskPath}
                  transform={`translate(${m.left} ${m.top}) scale(${(m.right - m.left) / s.width} ${(m.bottom - m.top) / s.height})`}
                  fill="rgb(249 115 22 / 0.35)"
                />
              ) : null}
              <rect
                x={b.left}
                y={b.top}
                width={Math.max(1, b.right - b.left)}
                height={Math.max(1, b.bottom - b.top)}
                fill="none"
                stroke="rgb(249 115 22)"
                strokeWidth={stroke}
                rx={stroke}
              />
              <rect x={b.left} y={b.top} width={font * 1.6} height={font * 1.3} fill="rgb(249 115 22)" />
              <text
                x={b.left + font * 0.8}
                y={b.top + font * 0.98}
                fontSize={font}
                fontWeight={700}
                textAnchor="middle"
                fill="white"
              >
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      {hidden > 0 ? (
        <figcaption className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
          {hidden} below threshold
        </figcaption>
      ) : null}
    </figure>
  );
}
