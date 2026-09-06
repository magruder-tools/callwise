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

Callwise is distributed under GPL-3.0-or-later. Other dependencies retain their
own licenses, available in the installed packages. This project is independent
of Cue, Glass, OpenAI, Fireflies, and Final Round AI.
