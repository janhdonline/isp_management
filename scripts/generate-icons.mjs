/**
 * Generates the PWA icons from a single vector source.
 *
 * Run with:  node scripts/generate-icons.mjs
 *
 * The icons are committed so a clone does not need an image toolchain to build,
 * but keeping the generator in the repo means a brand change is one command
 * rather than a hand-drawn file nobody can reproduce.
 */
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs/promises";

const OUT = path.join(process.cwd(), "public");
const BRAND = "#3163ff";

/** The mark: a rounded tile with the wordmark initial. */
function svg(size) {
  const r = size * 0.22;
  const fontSize = size * 0.52;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${BRAND}"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}"
        font-weight="700" fill="#ffffff">N</text>
</svg>`;
}

await fs.mkdir(OUT, { recursive: true });

for (const size of [192, 512]) {
  const file = path.join(OUT, `icon-${size}.png`);
  await sharp(Buffer.from(svg(size))).png().toFile(file);
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}

// The favicon browsers ask for, at the sizes they ask for it.
await sharp(Buffer.from(svg(64))).png().toFile(path.join(OUT, "favicon.png"));
await sharp(Buffer.from(svg(32))).png().toFile(path.join(OUT, "apple-touch-icon.png"));
console.log("wrote favicon.png and apple-touch-icon.png");
