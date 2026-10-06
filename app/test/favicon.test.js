/**
 * /favicon.ico (lib/favicon.js): a real ICO, drawn from favicon.svg, so the
 * two icons can never differ. What matters: the container is valid, every
 * image is a PNG of the size its entry declares, and the sizes include 48px,
 * the size Google asks for.
 */

const test = require('node:test');
const assert = require('node:assert');
const { faviconIco } = require('../server/lib/favicon');

const pngSize = png => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

test('favicon.ico is an ICO of PNGs at the sizes it declares', () => {
  const ico = faviconIco();
  assert.strictEqual(ico.readUInt16LE(0), 0);
  assert.strictEqual(ico.readUInt16LE(2), 1, 'type 1 is an icon');
  const count = ico.readUInt16LE(4);
  const sizes = [];
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    const size = ico[entry];
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    const png = ico.subarray(offset, offset + length);
    assert.strictEqual(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `image ${i} is a PNG`);
    assert.deepStrictEqual(pngSize(png), { width: size, height: size });
    sizes.push(size);
  }
  assert.ok(sizes.includes(48));
  assert.strictEqual(ico.length, 6 + 16 * count + sizes.reduce((n, _, i) => n + ico.readUInt32LE(6 + i * 16 + 8), 0));
});
