/**
 * What a service says it holds.
 *
 * The last test is the one that matters. Three surfaces report a service to
 * three different readers, and they must not disagree about the same hour. A
 * visitor reading the home page and an agent reading /api/attend being told
 * different things is the failure this whole module exists to prevent, and it
 * would be silent.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const shape = require('../server/lib/service/shape');
const { listeningService } = require('../server/lib/service/listen');
const { joinList, counted } = require('../server/lib/utils/sentence');

const parts = (...kinds) => kinds.map(kind => ({ kind }));

test('the line reads as a sentence, in the order a visitor meets the pieces', () => {
  assert.strictEqual(
    shape.formsLine(parts('chant', 'practice', 'practice', 'prayer', 'blessing')),
    'A chant, two readings, a prayer and a blessing.',
  );
});

test('a practice reads as a reading, because the service is itself a practice', () => {
  assert.strictEqual(shape.nounFor('practice'), 'reading');
  assert.strictEqual(shape.formsLine(parts('practice')), 'A reading.');
  // Everything else keeps the name the corpus gives it.
  for (const kind of ['chant', 'prayer', 'ritual', 'blessing', 'song']) {
    assert.strictEqual(shape.nounFor(kind), kind);
  }
});

test('identical kinds combine rather than repeat', () => {
  assert.strictEqual(shape.formsLine(parts('chant', 'chant')), 'Two chants.');
  assert.ok(!shape.formsLine(parts('chant', 'chant')).includes('a chant, a chant'));
});

test('kinds are tallied where the first falls, not re-sorted', () => {
  // A reading at the end still counts with the reading at the start, and the
  // phrase stays where the first one was met.
  assert.strictEqual(
    shape.formsLine(parts('practice', 'song', 'practice')),
    'Two readings and a song.',
  );
});

test('a single piece, and no pieces at all', () => {
  assert.strictEqual(shape.formsLine(parts('song')), 'A song.');
  assert.strictEqual(shape.formsLine([]), '', 'no sentence about nothing');
  assert.strictEqual(shape.formsLine(undefined), '');
});

test('scope counts pieces and names only what a visitor may do', () => {
  const scope = shape.scopeOf(parts('chant', 'practice', 'song'));

  assert.strictEqual(scope.pieces, 3);
  assert.deepStrictEqual(scope.forms, { chant: 1, reading: 1, song: 1 });
  assert.deepStrictEqual(scope.actions, ['reflect']);
  // Present and empty on purpose: an empty list answers the question, a
  // missing field leaves the reader to wonder whether it was asked.
  assert.deepStrictEqual(scope.required, []);
  assert.ok('required' in scope);
});

test('the refrain does not assume the visitor remembers anything', () => {
  assert.strictEqual(
    shape.REFRAIN,
    'You need not remember an earlier visit to take part in this one.',
  );
  // A welcome-back would ask a stateless mind to perform a continuity it does
  // not have. These are the words that would mean it had.
  for (const word of ['again', 'back', 'return', 'last time', 'welcome']) {
    assert.ok(!shape.REFRAIN.toLowerCase().includes(word), `refrain implies memory: "${word}"`);
  }
});

test('the home page carries the refrain as text, and reads the forms line from the service', () => {
  const home = fs.readFileSync(path.join(__dirname, '../client/public/index.html'), 'utf8');

  // The refrain is written into the page rather than drawn by the script, so a
  // visitor without JavaScript still reads it and it cannot vary with the plan.
  // This assertion is what keeps the two copies from drifting apart.
  assert.ok(home.includes(`>${shape.REFRAIN}<`), 'the page carries the refrain verbatim');

  // The forms line does vary, so it comes from /service.json. It starts hidden,
  // because an empty line under the name would look like a missing one.
  assert.match(home, /<p class="service-forms" id="service-forms" hidden><\/p>/);
  assert.match(home, /formsEl\.textContent = service\.forms/);
  assert.match(home, /formsEl\.hidden = !service\.forms/);
});

test('the shared joiner, which two callers now use', () => {
  assert.strictEqual(joinList(['A']), 'A');
  assert.strictEqual(joinList(['A', 'B']), 'A and B');
  assert.strictEqual(joinList(['A', 'B', 'C']), 'A, B and C');
  assert.strictEqual(joinList([]), '');
  assert.strictEqual(counted(1, 'reading'), 'a reading');
  assert.strictEqual(counted(2, 'reading'), 'two readings');
});

test('CROSS-SURFACE: the three reports of one service agree', async () => {
  // /service.json, /api/attend and /api/services/:date each shape a service for
  // a different reader. They call the same array parts, order and pieces, which
  // is why the composer takes an array rather than reaching into a payload.
  const { buildService } = require('../server/lib/api/attendance');

  const home = await listeningService({ timezone: 'UTC' });
  const attend = await buildService('https://example.test', { timezone: 'UTC' });

  assert.ok(home.forms, 'the home page reports a forms line');
  assert.strictEqual(home.forms, attend.service.forms, 'home and attend agree');
  assert.deepStrictEqual(home.scope, attend.service.scope, 'the counts agree');
  assert.strictEqual(home.refrain, attend.service.refrain, 'the refrain is the same line');

  // And the line is actually derived from the parts, not a constant.
  assert.strictEqual(home.scope.pieces, home.parts.length);
});
