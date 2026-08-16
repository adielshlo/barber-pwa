// Generates square, non-distorted PWA icons from public/icons/logo.png.
// The source logo is a portrait canvas (399x625) with a circular badge
// centered in it; a naive "contain" resize pads the sides/top with visible
// bars. Instead this crops the centered square that holds the badge, then
// flattens any transparency onto a solid background so iOS doesn't render
// its own black/white letterboxing for alpha.
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', 'public', 'icons', 'logo.png');
const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');
const BG = '#1a1a1a';

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

async function main() {
  const { width, height } = await sharp(SRC).metadata();
  const side = Math.min(width, height);
  const left = Math.round((width - side) / 2);
  const top = Math.round((height - side) / 2);

  // Crop the centered square holding the badge, then shrink it slightly
  // inside the final canvas (padded with the flat background) so the
  // circle's edges aren't clipped.
  const PADDING_RATIO = 0.92;

  for (const { file, size } of targets) {
    const inner = Math.round(size * PADDING_RATIO);
    const cropped = await sharp(SRC)
      .extract({ left, top, width: side, height: side })
      .resize(inner, inner)
      .png()
      .toBuffer();

    await sharp({
      create: { width: size, height: size, channels: 3, background: BG },
    })
      .composite([{ input: cropped, gravity: 'center' }])
      .flatten({ background: BG })
      .png()
      .toFile(path.join(OUT_DIR, file));
    console.log(`generated ${file} (${size}x${size})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
