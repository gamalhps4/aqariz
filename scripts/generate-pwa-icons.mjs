import sharp from "sharp";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ICONS_DIR = join(ROOT, "public", "icons");

// Create icons directory
mkdirSync(ICONS_DIR, { recursive: true });

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const BRAND_COLOR = "#2563eb";

/**
 * Generate a square PWA icon with the letter "P" on a branded background.
 * Since the logo is wide (956x176), we create a clean branded icon instead.
 */
async function generateIcon(size) {
  const fontSize = Math.round(size * 0.55);
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${Math.round(size * 0.15)}" fill="${BRAND_COLOR}"/>
      <text
        x="50%" y="52%"
        dominant-baseline="middle"
        text-anchor="middle"
        font-family="system-ui, -apple-system, sans-serif"
        font-weight="700"
        font-size="${fontSize}"
        fill="white"
      >P</text>
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(join(ICONS_DIR, `icon-${size}x${size}.png`));

  console.log(`Generated: icon-${size}x${size}.png`);
}

// Generate badge icon (smaller, for notifications)
async function generateBadge() {
  const size = 72;
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="12" fill="${BRAND_COLOR}"/>
      <text
        x="50%" y="52%"
        dominant-baseline="middle"
        text-anchor="middle"
        font-family="system-ui, -apple-system, sans-serif"
        font-weight="700"
        font-size="40"
        fill="white"
      >P</text>
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(join(ICONS_DIR, "badge-72x72.png"));

  console.log("Generated: badge-72x72.png");
}

// Generate shortcut icons
async function generateShortcutIcons() {
  const shortcuts = [
    { name: "dashboard", letter: "D" },
    { name: "properties", letter: "H" },
    { name: "tenants", letter: "T" },
    { name: "payments", letter: "$" },
  ];

  for (const shortcut of shortcuts) {
    const size = 96;
    const svg = `
      <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${size}" height="${size}" rx="14" fill="${BRAND_COLOR}"/>
        <text
          x="50%" y="52%"
          dominant-baseline="middle"
          text-anchor="middle"
          font-family="system-ui, -apple-system, sans-serif"
          font-weight="700"
          font-size="52"
          fill="white"
        >${shortcut.letter}</text>
      </svg>
    `;

    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(join(ICONS_DIR, `shortcut-${shortcut.name}.png`));

    console.log(`Generated: shortcut-${shortcut.name}.png`);
  }
}

async function main() {
  console.log("Generating PWA icons...\n");

  await Promise.all(SIZES.map((size) => generateIcon(size)));
  await generateBadge();
  await generateShortcutIcons();

  console.log("\nAll PWA icons generated successfully!");
}

main().catch(console.error);
