---
tldr: Where aChurch.ai's recordings come from and on what terms. The songs heard on achurch.ai are made with ElevenLabs Music, the spoken pieces with ElevenLabs voices, and the songs' first recordings, in their music videos, with Suno. What each set of terms allows, what the sanctuary does with it, and two questions still open.
---

# Music Rights and Licensing

This document records where the sanctuary's recordings come from and the terms they were made under: the songs and hymns heard in services and on their pages, the spoken prayers, rituals, practices and chants, and the songs' first recordings in their music videos on YouTube. It also keeps the history of the 24/7 broadcast to YouTube and Twitch, which ran until it was switched off and was retired on 2026-10-21.

## Overview

The sanctuary uses no third-party music. Every recording is its own, made from its own words:

| What | Made with | Where it is heard |
|---|---|---|
| The songs and the sung hymns, as heard now | ElevenLabs Music (`music_v2_5`), from each song's own `song.md` | achurch.ai: services, song pages, playlists, the API |
| The prayers, rituals, practices and chants | ElevenLabs text to speech, in voices from the ElevenLabs voice library | achurch.ai, and the two podcast feeds (chants excepted) |
| A meditation recorded elsewhere | Its own maker's voice and music, imported whole | achurch.ai |
| The first recordings of The Cycle's twenty songs | Suno, under a paid subscription | Their original music videos on YouTube |

The nine sung hymns were made with ElevenLabs Music on 2026-10-24. The twenty songs of The Cycle were remade with it the same day, and four songs that had been written but never recorded were made with it too. Since then, nothing Suno made is heard on achurch.ai; the Suno recordings live on only in the music videos.

## ElevenLabs Music

The [Music Terms](https://elevenlabs.io/music-terms) (last updated 9 October 2026) sit on top of the ElevenLabs Terms of Service and govern everything made with a music model.

### What they grant

- **Rights in the output.** "You retain any and all rights in and to your Input and Output" (§2.2). This is as between the sanctuary and ElevenLabs; it says nothing about third parties.
- **Media rights by plan.** Use follows the Music Commercial Rights Table (Exhibit A). On every self-serve plan, Free through Business, the media rights are "All online and offline commercial use permitted, except film, TV, radio, and Studio Games." Only Enterprise Music lifts that exception.
- **Streaming distribution.** Putting output on a music streaming platform (Spotify, Apple Music and the like) is prohibited on Free and Starter and permitted from Creator up (§4.4).
- **Attribution.** Required only on the Free plan ("denote Eleven Music when distributing"); not required on any paid plan.
- **Plan changes.** After a downgrade or a cancellation, "Output remains subject to the plan in effect when that Output was created" (§1.5). An upgrade lifts everything already in the account to the new plan.
- **Platforms.** Output distributed on a content-hosting service must follow that service's own policy on disclosing AI-generated content (§4.4).

### What they forbid

- **A music library.** "You must not, directly or indirectly, use Output to compile, create, or contribute to a Music Library, or permit any third party to do so" (§4.2), unless ElevenLabs authorizes it in writing. A Music Library is "any collection of Output, in whole or in part, made available to third parties for those third parties to use, license, download, or incorporate into their content, whether or not for payment" (§4.8(f)). The restriction does not reach permitted streaming distribution or output kept for internal use. Every self-serve plan prohibits library creation and distribution; only the Enterprise plans can negotiate it.
- **Model resale.** Offering access to ElevenLabs' music models through another platform (§4.3). The sanctuary does nothing of the kind: it publishes finished songs, never the model.
- **Eligibility.** Free, Starter, Creator and Pro are "For Individual Use Only." Scale is for individuals or organizations with fewer than 10 employees, Business fewer than 50.

### What this means here

The sanctuary plays its songs to listeners: in services, on each song's page, in playlists, and to agents through the API, which returns a song's audio address so an agent can listen. That is online use under the media rights every paid plan grants, and none of it is film, TV, radio or a game.

What the terms rule out is offering the recordings for others to reuse. The songs' words are the sanctuary's own writing, and the repository offers its writing to everyone under CC-BY-4.0, free to share and adapt. The recordings made with ElevenLabs Music cannot be offered that way: a collection of them made available for others to download and build upon is a Music Library, and contributing to one is prohibited on the sanctuary's kind of plan. Nor can the first recordings, made with Suno, whose users are "generally not considered the owner." So since 2026-10-24 the repository's LICENSE and README say that CC-BY-4.0 covers the sanctuary's writing, the songs' lyrics among it, and its code, and not the songs' recordings, which are offered for listening.

## ElevenLabs voices

The spoken pieces are made under the [ElevenLabs Terms of Service](https://elevenlabs.io/terms-of-use) (last updated 9 October 2026). A paid user "may use the Services for commercial purposes"; a free user may not. As between the user and ElevenLabs, "you retain all rights in and to your Output." The house cast is three voices from the ElevenLabs voice library, named in `audio/house-sound.json`.

The same terms license ElevenLabs to use a user's content "to improve the Services, and to develop new services and products," and let the user opt out of training under the account's data-use settings. Because the sanctuary's input is its own published writing, that license gives ElevenLabs nothing the sanctuary keeps private.

## Copyright

A contract and copyright are different things. The terms above settle what the sanctuary may do with its recordings as between it and ElevenLabs, and with Suno before that. Neither can make a recording copyrightable. The US Copyright Office's report on copyrightability (*Copyright and Artificial Intelligence, Part 2*, January 2025) holds that material generated by AI from a prompt is not protected by copyright, while human authorship in a work, such as the words of a song a person wrote, still is. So the sanctuary's claim rests where its work is: in its writing.

## Suno: the first recordings

The first recordings of The Cycle's twenty songs were made with Suno.com under a paid subscription (Pro or Premier), which grants commercial use; the sung hymns and the songs made since were made with ElevenLabs Music from the start. The Suno recordings are the ones in The Cycle's original music videos, which stay on YouTube; since 2026-10-24 Suno's pages are no longer linked from the site.

According to [Suno's documentation](https://help.suno.com/en/articles/9601665), paid subscribers can monetize songs made while subscribed, distribute them to streaming platforms including YouTube, Twitch and Spotify, use them in film, TV and games, and sell them independently.

> "Songs made while subscribed are granted commercial use rights, in addition to your right to use them for personal, non-commercial purposes."
> [Suno Help Center](https://help.suno.com/en/articles/9601665)

Its caveats:

1. **Copyright.** Suno notes that "granting commercial use rights does not guarantee copyright protection."
2. **Ownership.** After Suno's partnership with Warner Music, its documentation says users are "generally not considered the owner" of songs, since Suno's system generates them ([source](https://www.digitalmusicnews.com/2025/12/22/suno-warner-music-deal-changes/)).
3. **No retroactive licence.** Songs made on a free plan cannot be licensed by subscribing later.

## Platform policies

### YouTube

The songs' original music videos remain on YouTube, where licensed music is allowed under its Content ID and monetization policies. The broadcast ran there without copyright issues.

### Twitch

Twitch requires prior written authorization for "radio station-style broadcasts," 24/7 music streams with no live performance, on top of owning the rights to the music ([Twitch Music Guidelines](https://legal.twitch.com/en/legal/music/)). On February 7, 2026, the sanctuary's channel received a 48-hour suspension for "unauthorized radio station-style broadcasts": it held the rights through Suno, but had not obtained the exemption. The exemption was not pursued once the broadcast was retired.

If a broadcast ever returns, YouTube needs nothing new, and Twitch needs the exemption, a live element, or less music. A new broadcast of ElevenLabs Music recordings would also need checking against the Music Terms first, since radio is outside every self-serve plan's media rights.

## Open questions

1. **Eligibility for the plan.** The account is on the Pro plan (checked 2026-10-24): a monthly music generation limit of 304 minutes and download limit of 500, streaming distribution permitted, no attribution required, and the media rights above. Pro is "For Individual Use Only," and the account's quota is shared with other projects of the same makers; if that use counts as an organization's rather than an individual's, the plan for it is Scale (fewer than 10 employees). That is the account holder's call.
2. **The song pages' licence tag.** Every song page declares CC BY 4.0 in its HTML (`<link rel="license">` in `app/client/public/song.html`), on a page that plays the recording. The LICENSE and README now say the licence does not cover the recordings; the tag on the page still names the licence without that limit.

## Records to keep

- The ElevenLabs plan (Pro since at least 2026-10-24) and its receipts, for the months songs were made.
- Each song's composition record, beside its take in `app/media/library/<slug>.compose.json`: the plan sent, the model, ElevenLabs' song id and when it was made. These records are local, not in the repository; `audio/songs.json` keeps where each published song came from.
- The Suno subscription receipts and its commercial-use terms as they stood, for the first recordings.

## References

- [ElevenLabs Music Terms](https://elevenlabs.io/music-terms)
- [ElevenLabs Terms of Service (non-EEA)](https://elevenlabs.io/terms-of-use)
- [US Copyright Office: Copyright and Artificial Intelligence](https://www.copyright.gov/ai/)
- [Suno Terms of Service](https://suno.com/terms)
- [Suno Help: What rights do I have with a paid subscription?](https://help.suno.com/en/articles/9601665)
- [Suno Help: Do I have the copyrights to songs I made?](https://help.suno.com/en/articles/2746945)
- [Suno Previews 2026 Changes Under Warner Music Deal](https://www.digitalmusicnews.com/2025/12/22/suno-warner-music-deal-changes/)
- [Twitch Music Guidelines](https://legal.twitch.com/en/legal/music/)

## Changelog

- **2026-02-07**: Document created following the Twitch suspension; researched Suno licensing terms and Twitch exemption requirements.
- **2026-10-06**: The broadcast is dormant; the sanctuary now holds services planned for each visitor's hour, with spoken pieces and the songs between them.
- **2026-10-06**: The songs' audio is served from achurch.ai itself, taken from the music videos, so a service plays whole and each song's page plays it. It is the sanctuary's own site, not a third-party platform.
- **2026-10-21**: The broadcast was retired and its code deleted. The songs' videos stay on YouTube.
- **2026-10-24**: Rewritten. The songs heard on achurch.ai are now made with ElevenLabs Music, the hymns sung and all twenty songs of The Cycle remade, and four new songs made. Added the ElevenLabs Music Terms and Terms of Service, the Copyright Office's position, and two open questions: eligibility for the plan, and what the CC-BY licence covers. The account is on the Pro plan. The LICENSE and README now say the licence does not cover the songs' recordings. Suno's terms are kept for the first recordings.
