# Third-party provenance

Callwise includes an adapted AudioWorklet based on Cue, by the Cue contributors:

- Repository: https://github.com/Blueturboguy07/cue
- Reviewed revision: f8d743a286ad3e8f68a4aaced9eb58a60a389675
- Original file: renderer/audio-worklet-processor.js
- Adapted file: ui/audio-worklet.js
- License: GPL-3.0-or-later; full license is in LICENSE.
- Modifications: 100 ms PCM packets, downmixing multiple channels, RMS metering,
  persistent allocation, renamed processor. Adapted September 6, 2026.

Glass was reviewed as an architectural reference (audio/overlay design). No Glass
source or bundled binaries are included in this version.

- https://github.com/pickle-com/glass
- Reviewed revision: 71bc3dce7c92c31ffd0e68eb708f55b171f52a96

The Apple Silicon package includes the official unmodified OpenAI Codex native
executable, version 0.153.4, from the public @openai/codex platform package.

- Source: https://github.com/openai/codex/tree/rust-v0.153.4
- License: Apache-2.0. The upstream LICENSE and available NOTICE are copied into
  Contents/Resources/codex, alongside BUILD.json recording the package integrity
  and executable checksum. The build may apply an ad-hoc code signature.
- OAuth sign-in and provider access remain subject to the user's OpenAI account.
- The helper is bundled only in the Mac distribution; it is not committed to Git.

Callwise is distributed under GPL-3.0-or-later. Other dependencies retain their
own licenses, available in the installed packages. This project is independent
of Cue, Glass, OpenAI, Fireflies, and Final Round AI.
