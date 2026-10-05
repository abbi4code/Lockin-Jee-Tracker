// Draws the app icon (a dot-matrix "ℓ" with a red full stop, the "lockin." wordmark in one letter) and writes
// every size the site and the installed PWA need into public/. Run with `npm run icons` after changing the design.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const FG = "#ececec";
const RED = "#ff3b30";
const OFF = "#1c1c1c";

/**
 * 7×7 dot grid on black. `rx` rounds the tile (0 = full-bleed, for platforms that mask the icon themselves);
 * `scale` shrinks the dots toward the centre (maskable icons must keep their content inside the middle 80%).
 */
function svg({ rx = 112, scale = 1 } = {}) {
  const n = 7;
  const pitch = 54 * scale;
  const start = 256 - ((n - 1) / 2) * pitch;
  const lit = new Set(["0,2", "1,2", "2,2", "3,2", "4,2", "5,2", "6,3"]); // ℓ: stem + tail
  const red = "6,5"; // the full stop
  let dots = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const x = (start + c * pitch).toFixed(1);
      const y = (start + r * pitch).toFixed(1);
      const k = `${r},${c}`;
      if (k === red) dots += `<circle cx="${x}" cy="${y}" r="${21 * scale}" fill="${RED}"/>`;
      else if (lit.has(k)) dots += `<circle cx="${x}" cy="${y}" r="${21 * scale}" fill="${FG}"/>`;
      else dots += `<circle cx="${x}" cy="${y}" r="${6 * scale}" fill="${OFF}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${rx}" fill="#000"/>${dots}</svg>`;
}

const png = (source, size) => sharp(Buffer.from(source)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/** .ico with PNG frames (supported by every current browser). */
function ico(frames) {
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...frames.map((f) => f.data)]);
}

const rounded = svg();
const fullBleed = svg({ rx: 0 });
const maskable = svg({ rx: 0, scale: 0.8 });

writeFileSync(join(PUBLIC, "icon.svg"), rounded);
writeFileSync(join(PUBLIC, "pwa-64x64.png"), await png(rounded, 64));
writeFileSync(join(PUBLIC, "pwa-192x192.png"), await png(rounded, 192));
writeFileSync(join(PUBLIC, "pwa-512x512.png"), await png(rounded, 512));
writeFileSync(join(PUBLIC, "maskable-icon-512x512.png"), await png(maskable, 512));
// iOS rounds the corners itself and shows transparency as black, so the touch icon is full-bleed.
writeFileSync(join(PUBLIC, "apple-touch-icon-180x180.png"), await png(fullBleed, 180));
writeFileSync(join(PUBLIC, "favicon.ico"), ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(rounded, size) })))));
console.log("icons written to public/");
