# Recordings

Spoken recordings of the sanctuary's prayers, rituals and practices, played on each document's page. The audio lives in S3. This folder holds what makes it and what describes it:

- `house-sound.json`: the cast, three voices from the ElevenLabs voice library, with the speech model and how lines are spaced and leveled.
- `scripts/`: each document adapted for the ear, one JSON file per document. Every line names a role, not a voice. A line not marked `adapted` is the document's own words, and that is checked in code. A `hold` is a silence, in seconds.
- `manifest.json`: every published recording, with its file, length and voices, the hashes that say whether it is current, and what its player draws: 128 waveform peaks, the file of the visual's frames (a `.bin` beside the recording in S3), and cues saying which voices speak when.

The voices are AI voices, and every player says so.

To make or update recordings, from `app/`: `npm run audio:dry` to see what would be rendered and what it costs, then `npm run audio`. How it works: [docs/reference/app-development.md](../docs/reference/app-development.md).
