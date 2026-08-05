import type { ScanResult } from "../types/index.ts";
import { scoreBand } from "../scoring/trust-score.ts";

/** Markdown snippet for README (shields.io — rendered by GitHub/GitLab). */
export function formatBadgeMarkdown(result: ScanResult): string {
  const band = scoreBand(result.trustScore);
  const label = encodeURIComponent("NovaCheck");
  const message = encodeURIComponent(`${result.trustScore}/100`);
  const url = `https://img.shields.io/badge/${label}-${message}-${band.shields}`;
  return `[![NovaCheck](${url})](./.novacheck/report.html)`;
}

/** Self-contained SVG badge (local-first, no network). */
export function formatBadgeSvg(result: ScanResult): string {
  const band = scoreBand(result.trustScore);
  const colors: Record<string, string> = {
    brightgreen: "#4c1",
    green: "#97ca00",
    yellow: "#dfb317",
    orange: "#fe7d37",
    red: "#e05d44",
  };
  const right = colors[band.shields] ?? "#9f9f9f";
  const left = "#555";
  const leftText = "NovaCheck";
  const rightText = `${result.trustScore}/100`;
  const leftW = 78;
  const rightW = 54;
  const w = leftW + rightW;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${leftText}: ${rightText}">
  <title>${leftText}: ${rightText}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftW}" height="20" fill="${left}"/>
    <rect x="${leftW}" width="${rightW}" height="20" fill="${right}"/>
    <rect width="${w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${leftW / 2}" y="14">${leftText}</text>
    <text x="${leftW + rightW / 2}" y="14">${rightText}</text>
  </g>
</svg>
`;
}
