export function createRound3Ui({ state, ui, command, render, bridge, clipboard }) {
  const value = (id) => document.getElementById(id)?.value || "";
  const drafts = () => ui.round3Drafts ||= {};
  const edited = (s, cardId) => ({ say: value(`say-${cardId}`), cues: value(`cues-${cardId}`).split("\n").map(text => text.trim()).filter(Boolean).map((text, i) => ({ icon: s.bank.cards.find(c => c.id === cardId)?.cues[i]?.icon || "decision", text })) });
  const capture = (root) => { for (const n of root.querySelectorAll("[data-r3-draft]")) if (drafts()[n.dataset.r3Draft] !== undefined) drafts()[n.dataset.r3Draft] = n.value; };
  const edit = (node) => { if (node.dataset.r3Draft) drafts()[node.dataset.r3Draft] = node.value; };
  const restore = (root) => { for (const n of root.querySelectorAll("[data-r3-draft]")) if (drafts()[n.dataset.r3Draft] !== undefined) n.value = drafts()[n.dataset.r3Draft]; };
  async function act(action, node) {
    const s = state.get(), packId = node.dataset.packId || s.bank?.packId, cardId = node.dataset.cardId;
    switch (action) {
      case "r3-copy-prompt": { const result = await command("prep.copyPrompt"); if (result.text) await clipboard(result.text); else ui.notice = "Prep prompt copied."; break; }
      case "r3-import":
        if (bridge.desktop) await command("desktop.pack.import");
        else {
          const picker = document.createElement("input"); picker.type = "file"; picker.accept = ".json,application/json";
          picker.addEventListener("change", () => {
            const file = picker.files[0]; if (!file) return;
            if (file.size > 2 * 1024 * 1024) { ui.notice = "Keep prep JSON below 2 MB."; render(); return; }
            void file.text().then((json) => command("pack.import", { json })).catch(() => {});
          }, { once: true }); picker.click();
        }
        break;
      case "r3-build": await command("prep.build"); break;
      case "r3-confirm-prep": await command("prep.build", { confirmed: true }); break;
      case "r3-review": ui.screen = "ready"; ui.round3Drafts = {}; await command("bank.open", { packId }); break;
      case "r3-bank-close": await command("bank.close"); break;
      case "r3-remove": await command("pack.remove", { packId }); break;
      case "r3-use": { const result = await command("pack.use", { packId }); ui.meetingTitle = result.title; ui.meetingPeople = result.people?.join(", ") || ""; ui.screen = "ready"; break; }
      case "r3-card-edit": await command("bank.card.edit", { packId, cardId, ...edited(s, cardId) }); delete drafts()[`say:${cardId}`]; delete drafts()[`cues:${cardId}`]; break;
      case "r3-card-approve": await command("bank.card.edit", { packId, cardId, ...edited(s, cardId) }); await command("bank.card.approve", { packId, cardId }); delete drafts()[`say:${cardId}`]; delete drafts()[`cues:${cardId}`]; break;
      case "r3-approve-all": await command("bank.approveAll", { packId }); break;
      case "r3-gap-answer": await command("bank.gap.answer", { packId, gapId: node.dataset.gapId, answer: value(`gap-${node.dataset.gapId}`) }); delete drafts()[`gap:${node.dataset.gapId}`]; break;
      case "r3-phrasing-add": await command("bank.phrasing.add", { packId, cardId, phrasing: value(`phrasing-${cardId}`) }); delete drafts()[`phrasing:${cardId}`]; break;
      case "r3-phrasing-remove": await command("bank.phrasing.remove", { packId, cardId, phrasing: node.dataset.phrasing }); break;
      case "r3-watch-choose": await command("watchFolder.choose"); break;
      case "r3-watch-disable": await command("watchFolder.disable"); break;
      case "r3-rehearse": await command("bank.close"); ui.screen = "ready"; await command("rehearsal.start", { packId }); break;
      case "r3-rehearsal-next": await command("rehearsal.next"); break;
      case "r3-rehearsal-repeat": await command("rehearsal.repeat"); break;
      case "r3-rehearsal-stop": await command("rehearsal.stop"); ui.screen = "ready"; break;
      case "r3-surprise-add": ui.round3Drafts = {}; await command("debrief.surprise.add", { surpriseId: node.dataset.surpriseId, meetingId: node.dataset.meetingId }); ui.screen = "ready"; break;
      case "r3-attach-calendar": { const meeting = await command("pack.attachCalendar", { packId, eventId: node.dataset.eventId }); ui.meetingTitle = meeting.title; ui.meetingPeople = (meeting.people || []).join(", "); ui.screen = "ready"; break; }
      case "r3-other": await command("card.other"); break;
    }
    render();
  }
  function decorate(root, s) {
    const focus = root.querySelector(".stage-focus"), proof = s.stage?.current?.proof;
    if (focus && s.stage.phase === "early" && !focus.querySelector("[data-r3-early]")) {
      const tag = document.createElement("span"); tag.className = "stage-tag"; tag.dataset.r3Early = "true"; tag.textContent = "Early"; focus.querySelector(".stage-card-head")?.append(tag);
    }
    if (s.stage?.notice?.kind === "heard_unclear" && !s.stage.current && !root.querySelector(".round3-unclear")) {
      const notice = document.createElement("p"); notice.className = "banner round3-unclear"; notice.setAttribute("role", "status");
      notice.textContent = `I heard: “${s.stage.notice.text}”. Waiting for the question.`; root.querySelector(".stage-scroll")?.prepend(notice);
    }
    if (focus && s.stage?.current?.id.startsWith("wrapup-") && s.stage.current.cues.length > 3 && !focus.querySelector(".round3-wrapup")) {
      const list = document.createElement("ul"); list.className = "cues round3-wrapup";
      for (const c of s.stage.current.cues.slice(3)) { const item = document.createElement("li"); item.className = "cue"; item.textContent = c.text; list.append(item); }
      focus.append(list);
    }
    if (focus && proof?.type === "image" && /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,/.test(proof.src || "") && !focus.querySelector(".round3-proof-image")) {
      const image = document.createElement("img"); image.className = "proof round3-proof-image"; image.src = proof.src; image.alt = proof.alt || "Prepared proof tile"; focus.append(image);
    }
    if (focus && s.stage?.current && !focus.querySelector(".round3-stage-actions")) {
      const row = document.createElement("div"), button = document.createElement("button"); row.className = "round3-stage-actions";
      button.type = "button"; button.dataset.action = "r3-other"; button.textContent = "Other story"; row.append(button); focus.append(row);
    }
  }
  return { act, capture, restore, decorate, edit };
}
