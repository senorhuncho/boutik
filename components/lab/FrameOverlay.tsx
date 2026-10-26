"use client";

import type { FilteredDetections } from "@/lib/scan/accuracy";
import type { Detection } from "@/lib/scan/types";

interface Props {
  src: string;
  width: number;
  height: number;
  filtered: FilteredDetections;
  alt: string;
}

/**
 * A stall frame with SAM's results on top: counted units as numbered orange
 * masks, set-aside matches (too small, too large, low confidence) as dashed grey boxes.
 */
export function FrameOverlay({ src, width, height, filtered, alt }: Props) {
  const stroke = Math.max(2, Math.round(Math.max(width, height) / 400));
  const font = Math.max(14, Math.round(Math.max(width, height) / 45));
  const box = (d: Detection) => ({
    x: d.box.left,
    y: d.box.top,
    width: Math.max(1, d.box.right - d.box.left),
    height: Math.max(1, d.box.bottom - d.box.top),
  });

  return (
    <figure className="relative overflow-hidden bg-black/5">
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
      <img src={src} alt={alt} width={width} height={height} className="block h-auto w-full" />
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {filtered.dropped.map(({ detection: d }) => (
          <rect
            key={`x-${d.id}`}
            {...box(d)}
            fill="rgb(0 0 0 / 0.25)"
            stroke="rgb(255 255 255 / 0.85)"
            strokeWidth={stroke}
            strokeDasharray={`${stroke * 3} ${stroke * 2}`}
          />
        ))}
        {filtered.kept.map((d, i) => {
          const b = box(d);
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
              <rect {...b} fill="none" stroke="rgb(249 115 22)" strokeWidth={stroke} rx={stroke} />
              <rect x={b.x} y={b.y} width={font * 1.6} height={font * 1.3} fill="rgb(249 115 22)" />
              <text
                x={b.x + font * 0.8}
                y={b.y + font * 0.98}
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
    </figure>
  );
}
