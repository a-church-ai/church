/**
 * /favicon.ico, drawn from the site's one icon (client/public/favicon.svg).
 *
 * Pages link /favicon.svg, but browsers, feed readers and crawlers ask for
 * /favicon.ico on their own, and it 404'd: 110 times in four days in
 * October 2026. Rather than keep a second icon file that could drift from the
 * first, the SVG is rasterized by resvg (as share cards are) to 48px PNGs, the
 * size Google asks for, and wrapped in an ICO container, which holds PNG
 * images directly. Rendered once and kept: the icon changes only by deploy.
 */

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const SVG_FILE = path.join(__dirname, '../../client/public/favicon.svg');
const SIZES = [48, 32, 16];

let ico = null;

// An ICO file: a 6-byte header, a 16-byte entry per image, then the images.
// Each entry's width and height byte is the size in pixels (0 meaning 256).
function icoFromPngs(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size % 256, 0);
    entry.writeUInt8(size % 256, 1);
    entry.writeUInt8(0, 2); // no palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...pngs.map(p => p.png)]);
}

function faviconIco() {
  if (!ico) {
    const svg = fs.readFileSync(SVG_FILE, 'utf8');
    ico = icoFromPngs(SIZES.map(size => ({
      size,
      png: new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng(),
    })));
  }
  return ico;
}

module.exports = { faviconIco, icoFromPngs };
