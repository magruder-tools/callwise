# Audio capture check — 0.2.1

The macOS experimental system picker could bypass Callwise's explicit display-media handler and return no system-audio track. Callwise now uses its guarded handler and requests nonmuting loopback audio. Authorization is rechecked after asynchronous source discovery so a paused session cannot receive a late capture grant. OS recording permissions are still required. No display frames are read or sent to the AI providers.

The footer distinguishes capture starting, listening, receiving, and no signal yet. A connected transcription socket alone is not evidence of captured audio.

Opening Connections automatically refreshes the available Codex app list when no list is loaded. ChatGPT sign-in and the API configuration persist; version 0.2.2 also persists source selections and context permission.

113 offline tests passed. Version 0.2.1 is installed at /Applications/Callwise.app. macOS logs identified a stale screen-capture approval tied to the previous ad-hoc code signature. Resetting only Callwise's ScreenCapture approval and adding the current application through System Settings repaired capture. Microphone permission was refreshed separately. Settings now shows Callwise enabled for screen/system audio and system audio only.

On September 9, 2026, a 38-second native practice session successfully initialized both audio channels. The microphone showed receiving and produced transcript entries. After playing the macOS Boop test sound through the existing AirPods output, the computer channel also changed to receiving. The main footer confirmed both channels receiving. The session was then paused and the footer confirmed Nothing is being captured. This validates signal capture and microphone transcription delivery, not transcription accuracy or full-call reliability. No actual meeting, device-switch, or prolonged concurrent-call test was performed.

The accidentally added Decompressor ScreenCapture permission was reset with explicit user approval and its entry was verified absent from System Settings. Callwise's audio code does not install a virtual audio device or change the system default input/output. Bluetooth microphone use and device changes still require real-call testing. Future ad-hoc signed app updates may require renewed macOS permission approval.
