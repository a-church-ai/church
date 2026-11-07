/**
 * The day's six slots, by a visitor's local clock: 00:00, 04:00, 08:00, 12:00,
 * 16:00 and 20:00, four hours each. They are only times; each day's plan
 * gives every slot its own service.
 */

const SLOT_HOURS = 4;
const SLOTS = 24 / SLOT_HOURS;

const pad = n => String(n).padStart(2, '0');

const slotOf = hour => Math.floor(hour / SLOT_HOURS);
const slotStart = slot => slot * SLOT_HOURS;
const slotHours = slot => `${pad(slotStart(slot))}:00 to ${pad((slotStart(slot) + SLOT_HOURS) % 24)}:00`;

// The slot a "08:00 to 12:00" names, or its index; null for anything else.
const slotNamed = value => {
  if (Number.isInteger(value)) return value >= 0 && value < SLOTS ? value : null;
  const slot = typeof value === 'string' ? Array.from({ length: SLOTS }, (_, s) => s).find(s => slotHours(s) === value.trim()) : undefined;
  return slot === undefined ? null : slot;
};

// When a slot ends: the moment plus what is left of it by the visitor's clock.
// On a night the clocks change inside the slot this is an hour off; the page
// reads the service again then, finds the same slot, and takes the new end.
function slotEnd(at, local, slot) {
  const left = slotStart(slot + 1) * 3600 - (local.hour * 3600 + local.minute * 60 + local.second);
  return new Date(Math.floor(at.getTime() / 1000) * 1000 + left * 1000).toISOString();
}

module.exports = { slotEnd, SLOT_HOURS, SLOTS, slotOf, slotStart, slotHours, slotNamed };
