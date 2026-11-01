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

## Material extraction

PDF.js (pdfjs-dist), Apache-2.0: https://github.com/mozilla/pdf.js

Mammoth, BSD-2-Clause: https://github.com/mwilliamson/mammoth.js

Their license notices remain with installed dependencies. DOCX extraction uses raw text rather than HTML. The Mammoth CLI-only argparse dependency is overridden to 2.0.1 to avoid its old sprintf-js dependency.


## Local meeting components added in 0.5

- **FluidAudio v0.12.4** — Apache-2.0; https://github.com/FluidInference/FluidAudio/tree/v0.12.4. Used for local offline diarization. The exact transitive source revisions are in `native/CallwiseNative/Package.resolved`; this tag has no NemoTextProcessing binary target. Sources/licenses for FluidAudio, FastCluster, swift-transformers/Tokenizers, swift-huggingface, swift-jinja, EventSource, yyjson, swift-crypto, swift-asn1 and swift-collections remain with their packages. A packaged copy of source dependency license files is in the native notices folder.
- **Community-1 Core ML conversions** — supported artifacts only, CC-BY-4.0. Attribution: pyannote, WeSpeaker, Brno University of Technology / BUT Speech@FIT, and Fluid Inference. Fluid Inference modified the source models into Core ML graphs, separated feature extraction, adjusted shapes/precision and compiled Apple-platform artifacts. See `native/resources/MODEL-NOTICE.md`, bundled model `NOTICE.md`, `LICENSE`, and `provenance.json` for exact scope, historical provenance limitations, citations and source references. https://huggingface.co/FluidInference/speaker-diarization-coreml and https://creativecommons.org/licenses/by/4.0/ . Legacy wespeaker/segmentation models are not bundled.
- **MiniSearch 7.2.0** — MIT; https://github.com/lucaong/minisearch. In-memory meeting retrieval.
- **@breezystack/lamejs 1.2.7** — LGPL-3.0; https://github.com/shijinyu/lamejs. Unmodified JavaScript MP3 encoder, retained separately in installed dependencies/app resources with its license. The GPL-3.0-or-later Callwise source and exact dependency lock permit rebuilding/replacing this component.

Apple Speech, Foundation Models, EventKit, Core ML and AVFoundation are system frameworks, not redistributed model libraries. Their availability depends on the user's Mac and installed Apple assets. Only SystemLanguageModel is selected for local generation.
