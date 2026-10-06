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

module.exports = { SLOT_HOURS, SLOTS, slotOf, slotStart, slotHours };
