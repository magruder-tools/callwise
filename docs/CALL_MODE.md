# Call mode — 0.2.0

The live view has one stable next-move card and a smaller strategic insight. Incoming suggestions wait behind the New suggestion / New insight buttons. The current card stays visible when it gets old or the session is paused; its age label changes instead. Details and source links expand inside the card, preserving the surrounding layout.

Setup, transcript, and suggestion history open in separate dialogs. History remains available for the current session, including kept and dismissed suggestions. Closing the app or creating a new session clears it; use Export session to save a copy.

Automatic coaching is quieter: an 18-second fast cooldown, 60-second strategy cooldown, and a higher threshold for unsolicited suggestions. Manual questions still work immediately. Model confidence is not a calibrated reliability score.

The default desktop window is 680 × 850, with a 460 × 800 floating mode. The key and connection configuration remain in the existing Callwise application-support directory. No credentials are bundled in the application or source archive.

Validation: 109 offline tests and JavaScript/metadata checks pass. The running browser demo was checked at the floating-window width, including transcript overlay geometry, new-suggestion queuing, manual advancement, and readable controls. Tests cover retaining the card DOM node, open details and internal scroll when suggestions arrive, expiration during pause, history, and new-session reset. The installed macOS app was relaunched and visually verified in floating mode: the demo retained its original advice while two new suggestions queued, the transcript opened separately, and pausing preserved both advice cards.
