# Quiet assistant startup — 0.6.1

Callwise's Claude/Codex connections launched the normal GUI executable and hid its Dock presence only after Electron was ready. This allowed a background connection or reconnect to look like an app launch. Ten assistant processes were observed while no normal Callwise window process was running; they belonged to open assistant connections, not call sessions.

The signed macOS bundle now declares `LSUIElement: true`, so the operating system starts it as an agent before JavaScript loads. Assistant mode keeps accessory activation and disables graphics acceleration. It never creates a window or calls `dock.hide()` after startup. Normal GUI startup explicitly switches to regular activation. An explicit Dock/open action routed to an assistant process opens the GUI separately, using the existing GUI single-instance lock. No audio starts from an assistant connection or a window-open action.

Assistant transport now handles SIGTERM/SIGINT by stopping new input, finishing the current awaited request, closing the library and quitting. Stdin EOF also closes it. Separate open chats may still have separate helper processes; an arbitrary process-count cap would break valid connections. Old helper instances can be refreshed once after installation, and inactive helper caches can be backed up. No assistant integration is disabled.

The UI, card contract, participant notice, assistant consent gates, encryption keys and signing identities are unchanged. No network listener or paid service was added.

Validation so far: 447 tests pass; syntax covers 188 modules. The signed native assistant check opens two real processes with synthetic profiles and confirms no Dock visibility, no windows, no automatic activation, all seven tools, the public prep guide, disabled private-data gates, graceful signal shutdown, continued operation of the other connection and EOF cleanup. Native GUI smoke passes after awaiting explicit Dock promotion, including 40/40 synthetic presses. Final package, installation and PR checks are recorded below when complete.

References: [Apple's agent-app bundle setting](https://developer.apple.com/documentation/bundleresources/information-property-list/lsuielement), [Electron activation policy](https://www.electronjs.org/docs/latest/api/app/#appsetactivationpolicypolicy-macos).
