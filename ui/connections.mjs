// Credentials stay in the trusted desktop process; app permissions change only
// when the user explicitly chooses Use selected apps or Turn off app access.
export const connectionError = (error) =>
  String(error?.message || error || "Connection unavailable.").replace(
    /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
    "",
  );
export function connectionControls(bridge, { toast, showError }) {
  const $ = (id) => document.getElementById(id);
  let snapshot,
    catalogSignature = "",
    settingsSignature = "",
    modelSignature = "",
    showAll = false;
  const pending = new Set();
  const locked = () =>
    !bridge.desktop || snapshot?.status === "running" || snapshot?.connecting;
  const selected = () =>
    [...$("codex-apps").querySelectorAll("input")]
      .filter((input) => input.checked && input.dataset.ready === "true")
      .map((input) => input.dataset.appId);
  const enabled = () =>
    !!snapshot?.settings.contextConsent &&
    snapshot.settings.contextBackend !== "off";
  function listState() {
    const inputs = [...$("codex-apps").querySelectorAll("input")];
    const query = $("codex-filter").value.trim().toLowerCase();
    const hasSelection = inputs.some((input) => input.checked);
    for (const input of inputs)
      input.parentElement.hidden = query
        ? !input.parentElement.textContent.toLowerCase().includes(query)
        : hasSelection && !showAll && !input.checked;
    $("codex-show-all").textContent = showAll ? "Show selected" : "Add apps";
    $("codex-show-all").hidden = !inputs.length;
    $("codex-selection-count").textContent =
      `${selected().length} selected · choose up to 12 apps`;
  }
  function disable() {
    const discovering =
      pending.has("inspect-codex") ||
      snapshot?.contextConnection?.status === "checking";
    const signing = pending.has("codex-signin");
    for (const id of [
      "inspect-codex",
      "codex-signin",
      "apply-context",
      "context-backend",
      "auto-search",
      "context-project",
      "codex-disable",
      "save-connections",
      "check-connections",
      "openai-key",
      "fireflies-key",
      "fast-model",
      "strategy-model",
      "transcription-model",
    ])
      $(id).disabled = locked() || pending.has(id);
    $("inspect-codex").disabled ||= signing || discovering;
    $("codex-signin").disabled ||= discovering;
    $("apply-context").disabled ||= discovering || signing;
    $("codex-disable").disabled ||= discovering || signing;
    $("codex-cancel-signin").hidden = !signing;
    $("codex-cancel-discovery").hidden = !discovering || signing;
    $("context-cancel").hidden = snapshot?.retrieval?.status !== "searching";
    $("codex-disable").hidden = !enabled();
    $("codex-search-open").disabled =
      !enabled() ||
      discovering ||
      signing ||
      snapshot?.retrieval?.status === "searching";
    for (const input of $("codex-apps").querySelectorAll("input"))
      input.disabled =
        locked() || discovering || signing || input.dataset.ready !== "true";
  }
  function status() {
    const c = snapshot?.contextConnection || {},
      apps = snapshot?.contextApps || [];
    const signedIn = c.signedIn || apps.length > 0;
    const count = snapshot?.settings.contextApps?.length || 0;
    let title, detail, short;
    if (!bridge.desktop) {
      title = "Open Callwise on your Mac";
      detail = "The browser demo does not connect to Codex.";
      short = "Desktop only";
    } else if (pending.has("codex-signin")) {
      title = "Connecting to Codex…";
      detail =
        "Your saved sign-in will be reused. If needed, complete sign-in in your browser.";
      short = "Connecting…";
    } else if (c.status === "checking" || pending.has("inspect-codex")) {
      title = c.stage || "Checking Codex…";
      detail = "Your saved app choices stay in place while this check runs.";
      short = "Checking…";
    } else if (c.status === "error") {
      title = "Codex needs attention";
      detail = connectionError(c.error);
      short = "Needs attention";
    } else if (signedIn) {
      title = enabled()
        ? snapshot.settings.contextBackend === "mcp"
          ? "Your search source is enabled"
          : `${count} ${count === 1 ? "app" : "apps"} enabled`
        : "Codex connected · app access is off";
      detail = enabled()
        ? "Saved on this Mac for future calls. You can search now or change your selection below."
        : "Choose Use selected apps below to let Callwise search your saved selection.";
      short = enabled() ? `${count} enabled` : "App access off";
    } else {
      title = "Connect your Codex apps";
      detail =
        "Reuse your existing Codex ChatGPT sign-in, then choose the apps Callwise can search.";
      short = "Connect";
    }
    $("codex-status-title").textContent = title;
    $("codex-status-detail").textContent = detail;
    $("codex-status-short").textContent = short;
    $("codex-signin").hidden =
      signedIn && c.status !== "error" && !pending.has("codex-signin");
    $("apply-context").textContent = enabled()
      ? "Save app choices"
      : "Use selected apps";
  }
  async function run(id, task, target = "codex-result") {
    if (
      pending.has(id) ||
      (locked() &&
        ![
          "context-cancel",
          "codex-cancel-discovery",
          "codex-cancel-signin",
        ].includes(id))
    )
      return;
    pending.add(id);
    disable();
    status();
    try {
      await task();
    } catch (error) {
      const message = connectionError(error);
      $(target).textContent = message;
      showError(message);
    } finally {
      pending.delete(id);
      disable();
      status();
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
      settings.project,
    ]);
    const changed = settingsSignature !== settingsKey;
    if (changed) {
      settingsSignature = settingsKey;
      $("context-backend").value =
        settings.contextBackend === "mcp" ? "mcp" : "codex";
      $("auto-search").checked = !!settings.autoSearch;
      $("context-project").value = settings.project || "";
    }
    const apps = state.contextApps || [];
    const catalogKey = JSON.stringify(apps);
    if (catalogSignature !== catalogKey) {
      const previous = selected(),
        hadCatalog = $("codex-apps").querySelectorAll("input").length > 0;
      const choices =
        changed || !hadCatalog ? settings.contextApps || [] : previous;
      catalogSignature = catalogKey;
      $("codex-apps").replaceChildren();
      if (!apps.length) {
        const p = document.createElement("p");
        p.className = "muted micro";
        p.textContent = (settings.contextApps || []).length
          ? "Your saved choices will appear here when the check finishes."
          : "Connect to Codex to see available apps.";
        $("codex-apps").append(p);
      }
      for (const app of [...apps].sort(
        (a, b) =>
          Number(choices.includes(b.id)) - Number(choices.includes(a.id)) ||
          a.name.localeCompare(b.name),
      )) {
        const label = document.createElement("label");
        label.className = "context-app";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.dataset.appId = app.id;
        input.dataset.ready = String(!!app.ready);
        input.checked = choices.includes(app.id);
        const text = document.createElement("span"),
          name = document.createElement("strong"),
          detail = document.createElement("small");
        name.textContent = app.name;
        detail.textContent = app.ready
          ? "Available · read-only"
          : "Unavailable in Callwise";
        text.append(name, detail);
        label.append(input, text);
        $("codex-apps").append(label);
        input.addEventListener("change", () => {
          // Keep the edited list stable until the user deliberately switches views.
          $("codex-selection-count").textContent =
            `${selected().length} selected · choose up to 12 apps`;
          $("codex-result").textContent =
            "Unsaved app choices. Choose Use selected apps or Save app choices below.";
        });
      }
      listState();
    } else if (changed) {
      for (const input of $("codex-apps").querySelectorAll("input"))
        input.checked = (settings.contextApps || []).includes(
          input.dataset.appId,
        );
      listState();
    }
    const config = state.config || {},
      modelKey = JSON.stringify([
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
    $("context-lookup-status").textContent = !enabled()
      ? "App access is off. Open Codex apps to enable your selection."
      : retrieval.detail || "Ready to search your apps.";
    $("context-lookup-count").textContent =
      `${retrieval.searches || 0} / ${retrieval.limit || 20} lookups this call`;
    $("context-lookup-status").classList.toggle(
      "thinking",
      retrieval.status === "searching",
    );
    disable();
    status();
  }
  const discover = (force = false) =>
    run("inspect-codex", async () => {
      $("codex-result").textContent = "";
      await bridge.command("context.discover", { force });
    });
  $("inspect-codex").addEventListener("click", () => discover(true));
  $("codex-signin").addEventListener("click", () =>
    run("codex-signin", async () => {
      $("codex-result").textContent = "";
      await bridge.command("desktop.codex.signin");
      await bridge.command("context.discover", { force: true });
      toast("Codex connected. Your apps are ready to choose.");
    }),
  );
  $("codex-cancel-signin").addEventListener("click", () =>
    run("codex-cancel-signin", () => bridge.command("desktop.codex.cancel")),
  );
  for (const id of ["context-cancel", "codex-cancel-discovery"])
    $(id).addEventListener("click", () =>
      run(id, () => bridge.command("context.cancel")),
    );
  $("codex-filter").addEventListener("input", listState);
  $("codex-show-all").addEventListener("click", () => {
    showAll = !showAll;
    listState();
  });
  $("apply-context").addEventListener("click", () =>
    run("apply-context", async () => {
      const backend = $("context-backend").value,
        apps = backend === "codex" ? selected() : [],
        project = $("context-project").value.trim();
      if (backend === "codex" && (!apps.length || apps.length > 12))
        throw new Error("Choose between 1 and 12 available apps.");
      if ($("auto-search").checked && !project)
        throw new Error(
          "Enter a client or project above for automatic lookup, or turn automatic lookup off.",
        );
      await bridge.command("configure", {
        contextBackend: backend,
        contextApps: backend === "codex" ? apps : snapshot.settings.contextApps,
        contextConsent: true,
        autoSearch: $("auto-search").checked,
        project,
      });
      $("codex-result").textContent =
        "Saved. App access will stay enabled for future calls.";
      toast("Your app choices are saved.");
    }),
  );
  $("codex-disable").addEventListener("click", () =>
    run("codex-disable", async () => {
      await bridge.command("configure", {
        contextConsent: false,
        contextBackend: "off",
        autoSearch: false,
      });
      $("codex-result").textContent =
        "App access is off. Your app choices are kept for next time.";
    }),
  );
  $("save-connections").addEventListener("click", () =>
    run(
      "save-connections",
      async () => {
        try {
          await bridge.command("desktop.connections.save", {
            openaiKey: $("openai-key").value,
            firefliesKey: $("fireflies-key").value,
            fastModel: $("fast-model").value,
            strategyModel: $("strategy-model").value,
            transcriptionModel: $("transcription-model").value,
          });
          $("connection-result").textContent =
            "AI settings saved securely on this Mac. Your app choices are kept.";
          toast("AI settings saved.");
        } finally {
          $("openai-key").value = "";
          $("fireflies-key").value = "";
        }
      },
      "connection-result",
    ),
  );
  $("check-connections").addEventListener("click", () =>
    run(
      "check-connections",
      async () => {
        $("connection-result").textContent = "Checking saved model access…";
        const checks = await bridge.command("desktop.connections.check");
        $("connection-result").textContent = checks
          .map(
            (c) =>
              `${c.ok ? "Available" : "Needs attention"} — ${c.label}: ${c.detail}`,
          )
          .join("\n");
      },
      "connection-result",
    ),
  );
  return { sync, open: () => discover(false), enabled };
}
