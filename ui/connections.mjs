// Connection UI contains no persistent storage. Secrets only travel to the trusted
// desktop main process on an explicit Save click, then are cleared from the form.
export function connectionControls(bridge, { toast, showError }) {
  const $ = (id) => document.getElementById(id);
  let snapshot,
    catalogSignature = "",
    settingsSignature = "",
    modelSignature = "";
  const pending = new Set();
  const locked = () =>
    !bridge.desktop || snapshot?.status === "running" || snapshot?.connecting;
  const selected = () =>
    [...$("codex-apps").querySelectorAll("input")]
      .filter((input) => input.checked && !input.disabled)
      .map((input) => input.dataset.appId);
  function disable() {
    for (const id of [
      "inspect-codex",
      "apply-context",
      "context-backend",
      "context-consent",
      "auto-search",
      "save-connections",
      "check-connections",
      "openai-key",
      "fireflies-key",
      "fast-model",
      "strategy-model",
      "transcription-model",
    ])
      $(id).disabled = locked() || pending.has(id);
    for (const input of $("codex-apps").querySelectorAll("input"))
      input.disabled = locked() || input.dataset.ready !== "true";
    $("context-cancel").hidden =
      snapshot?.retrieval?.status !== "searching" &&
      !pending.has("inspect-codex");
  }
  async function run(id, task) {
    if (pending.has(id)) return;
    pending.add(id);
    disable();
    try {
      await task();
    } catch (error) {
      $("connection-result").textContent = error.message;
      showError(error.message);
    } finally {
      pending.delete(id);
      disable();
    }
  }
  function sync(state) {
    snapshot = state;
    const settings = state.settings;
    const settingsKey = JSON.stringify([
      state.sessionId,
      settings.contextBackend,
      settings.contextApps,
      settings.contextConsent,
      settings.autoSearch,
    ]);
    const changed = settingsSignature !== settingsKey;
    if (changed) {
      settingsSignature = settingsKey;
      $("context-backend").value = settings.contextBackend || "off";
      $("context-consent").checked = !!settings.contextConsent;
      $("auto-search").checked = !!settings.autoSearch;
    }
    const apps = state.contextApps || [];
    const catalogKey = JSON.stringify(apps);
    if (catalogSignature !== catalogKey) {
      const previouslySelected = selected();
      catalogSignature = catalogKey;
      $("codex-apps").replaceChildren();
      if (!apps.length) {
        const p = document.createElement("p");
        p.className = "muted micro";
        p.textContent = bridge.desktop
          ? "Click Find my apps to check the apps available through your local Codex sign-in."
          : "Open the desktop app to connect accounts. This demo never contacts Codex.";
        $("codex-apps").append(p);
      }
      for (const app of apps) {
        const label = document.createElement("label");
        label.className = "context-app";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.dataset.appId = app.id;
        input.dataset.ready = String(!!app.ready);
        input.checked = (
          changed ? settings.contextApps || [] : previouslySelected
        ).includes(app.id);
        const text = document.createElement("span");
        const name = document.createElement("strong");
        name.textContent = app.name;
        const detail = document.createElement("small");
        detail.textContent = app.ready
          ? `${app.readOnlyToolCount} read-only tools available`
          : "Not callable here, disabled, or missing read-only metadata";
        text.append(name, detail);
        label.append(input, text);
        $("codex-apps").append(label);
      }
    } else if (changed) {
      for (const input of $("codex-apps").querySelectorAll("input"))
        input.checked = (settings.contextApps || []).includes(
          input.dataset.appId,
        );
    }
    const config = state.config || {};
    const modelKey = JSON.stringify([
      config.fastModel,
      config.strategyModel,
      config.transcriptionModel,
    ]);
    if (modelSignature !== modelKey) {
      modelSignature = modelKey;
      for (const [id, key] of [
        ["fast-model", "fastModel"],
        ["strategy-model", "strategyModel"],
        ["transcription-model", "transcriptionModel"],
      ])
        if (config[key]) $(id).value = config[key];
    }
    const retrieval = state.retrieval || {};
    $("context-lookup-status").textContent =
      settings.contextBackend === "off"
        ? "Connected context is off."
        : retrieval.detail || "Ready for a context question.";
    $("context-lookup-count").textContent =
      `${retrieval.searches || 0} / ${retrieval.limit || 20} Codex lookups this session`;
    $("context-lookup-status").classList.toggle(
      "thinking",
      retrieval.status === "searching",
    );
    disable();
  }
  $("inspect-codex").addEventListener("click", () =>
    run("inspect-codex", async () => {
      $("connection-result").textContent =
        "Checking Codex sign-in, available apps, and read-only tools…";
      const result = await bridge.command("context.discover");
      const ready = result.apps.filter((a) => a.ready).length;
      $("connection-result").textContent =
        `${ready} of ${result.apps.length} accessible apps are ready. Select only the sources appropriate for this call. ${result.note || ""}`;
    }),
  );
  $("apply-context").addEventListener("click", () =>
    run("apply-context", async () => {
      const backend = $("context-backend").value;
      const apps = backend === "codex" ? selected() : [];
      const consent = $("context-consent").checked;
      if (backend === "codex" && consent && !apps.length)
        throw new Error(
          "Select at least one ready app, or leave connected context off.",
        );
      if (
        backend !== "off" &&
        $("auto-search").checked &&
        (!consent || !snapshot.settings.project.trim())
      )
        throw new Error(
          "Automatic context needs a named Context scope and your session permission.",
        );
      await bridge.command("configure", {
        contextBackend: backend,
        contextApps: apps,
        contextConsent: backend !== "off" && consent,
        autoSearch: backend !== "off" && $("auto-search").checked,
      });
      $("connection-result").textContent =
        backend === "off"
          ? "Connected searches are off. Previously retrieved connector sources were cleared."
          : "Context choices applied for this session. Try Search connected context before starting a call.";
      toast("Context preferences applied.");
    }),
  );
  $("context-cancel").addEventListener("click", () =>
    run("context-cancel", async () => {
      await bridge.command("context.cancel");
    }),
  );
  $("save-connections").addEventListener("click", () =>
    run("save-connections", async () => {
      try {
        await bridge.command("desktop.connections.save", {
          openaiKey: $("openai-key").value,
          firefliesKey: $("fireflies-key").value,
          fastModel: $("fast-model").value,
          strategyModel: $("strategy-model").value,
          transcriptionModel: $("transcription-model").value,
        });
        $("connection-result").textContent =
          "Connections saved encrypted on this computer. Refresh and reselect Codex context apps if needed. No live inference was tested.";
        toast("Connections saved.");
      } finally {
        $("openai-key").value = "";
        $("fireflies-key").value = "";
      }
    }),
  );
  $("check-connections").addEventListener("click", () =>
    run("check-connections", async () => {
      $("connection-result").textContent =
        "Checking saved model access (no audio or inference request)…";
      const checks = await bridge.command("desktop.connections.check");
      $("connection-result").textContent = checks
        .map(
          (c) =>
            `${c.ok ? "Available" : "Needs attention"} — ${c.label}: ${c.detail}`,
        )
        .join("\n");
    }),
  );
  return { sync };
}
