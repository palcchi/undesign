import siteContent from "../showcase/content.json";
import "./styles.css";

type SiteContent = typeof siteContent;
const copy: SiteContent = siteContent;
const root: HTMLDivElement = (() => {
  const element = document.querySelector<HTMLDivElement>("#app");
  if (!element) throw new Error("The showcase root element is missing.");
  return element;
})();

function escapeHtml(value: string): string {

  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function setMeta(name: string, value: string, property = false): void {
  const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    if (property) element.setAttribute("property", name);
    else element.name = name;
    document.head.append(element);
  }
  element.content = value;
}

function setPageMeta(title: string, description: string): void {
  document.title = title;
  setMeta("description", description);
  setMeta("og:title", title, true);
  setMeta("og:description", description, true);
  setMeta("og:image", new URL(copy.meta.socialImage, window.location.origin).href, true);
  setMeta("og:image:alt", copy.meta.socialImageAlt, true);
  setMeta("og:url", window.location.href, true);
  setMeta("twitter:card", "summary_large_image");
  setMeta("twitter:title", title);
  setMeta("twitter:description", description);
  setMeta("twitter:image", new URL(copy.meta.socialImage, window.location.origin).href);
}

function icon(name: "arrow" | "copy" | "external" | "close"): string {
  const paths: Record<typeof name, string> = {
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function buildPromptItems(prompts: readonly string[], ariaTemplate: string, buttonLabel: string): string {
  return prompts
    .map((prompt, index) => {
      const safePrompt = escapeHtml(prompt);
      const ariaLabel = escapeHtml(ariaTemplate.replace("{prompt}", prompt));
      return `<li class="prompt-item"><span class="prompt-index" aria-hidden="true">0${index + 1}</span><p>${safePrompt}</p><button class="copy-button" type="button" data-copy-prompt="${safePrompt}" aria-label="${ariaLabel}">${icon("copy")}<span>${escapeHtml(buttonLabel)}</span></button></li>`;
    })
    .join("");
}

function attachCopyActions(status: HTMLElement, successText: string, failureText: string): void {
  document.querySelectorAll<HTMLButtonElement>("[data-copy-prompt]").forEach((button) => {
    button.addEventListener("click", async () => {
      const prompt = button.dataset.copyPrompt ?? "";
      let copied = false;
      try {
        await navigator.clipboard.writeText(prompt);
        copied = true;
      } catch {
        const temporaryInput = document.createElement("textarea");
        temporaryInput.value = prompt;
        temporaryInput.setAttribute("aria-hidden", "true");
        temporaryInput.tabIndex = -1;
        temporaryInput.className = "copy-buffer";
        document.body.append(temporaryInput);
        temporaryInput.select();
        try {
          copied = document.execCommand("copy");
        } catch {
          copied = false;
        }
        temporaryInput.remove();
      }
      status.textContent = copied ? successText : failureText;
    });
  });
}

function renderWorkspacePreview(): string {
  const folders = copy.home.previewFolderNames
    .map((name, index) => `<li class="folder-row${index === 0 ? " is-current" : ""}"><span class="folder-symbol" aria-hidden="true"></span><span>${escapeHtml(name)}</span></li>`)
    .join("");
  const layers = copy.home.previewTimelineLayers
    .map((name, index) => `<div class="timeline-track"><span class="track-name">${escapeHtml(name)}</span><span class="track-line"><i class="keyframe keyframe-${index + 1}"></i><i class="playhead"></i></span></div>`)
    .join("");
  const tabs = copy.home.previewArtboardTabs.map((label) => `<span>${escapeHtml(label)}</span>`).join("");
  const markers = copy.home.previewTimelineMarkers.map((label) => `<span>${escapeHtml(label)}</span>`).join("");

  return `<div class="workspace-window" role="img" aria-label="${escapeHtml(copy.home.previewLabel)}">
    <div class="workspace-topbar"><div class="workspace-identity"><span class="brand-mark" aria-hidden="true">U</span><span>${escapeHtml(copy.home.previewProject)}</span></div><div class="workspace-tabs"><span class="workspace-tab is-active">${escapeHtml(copy.home.previewDocument)}</span><span class="workspace-tab">${escapeHtml(copy.home.previewTimelineLabel)}</span></div><span class="workspace-save" aria-hidden="true"></span></div>
    <div class="workspace-body"><aside class="workspace-folders"><h2>${escapeHtml(copy.home.previewFolderHeading)}</h2><ul>${folders}</ul></aside><section class="workspace-canvas" aria-label="${escapeHtml(copy.home.previewCanvasHeading)}"><div class="artboard-mini"><div class="artboard-mini-top"><strong>${escapeHtml(copy.home.previewArtboardName)}</strong><span>${tabs}</span></div><div class="artboard-mini-main"><div><h3>${escapeHtml(copy.home.previewCanvasHeading)}</h3><p>${escapeHtml(copy.home.previewCanvasCopy)}</p><span class="artboard-mini-button">${escapeHtml(copy.home.previewCanvasAction)}</span></div><div class="balance-card" aria-hidden="true"><div class="balance-line"></div><div class="balance-line short"></div><div class="balance-bars"><i></i><i></i><i></i><i></i><i></i></div></div></div><div class="artboard-mini-bottom"><i></i><i></i><i></i></div></div><div class="canvas-toolbar" aria-hidden="true"><span class="toolbar-tool"></span><span class="toolbar-tool"></span><span class="toolbar-tool"></span><b>${escapeHtml(copy.app.previewTabMotion)}</b></div></section></div>
    <div class="workspace-timeline"><div class="timeline-heading"><strong>${escapeHtml(copy.home.previewTimelineLabel)}</strong>${markers}</div>${layers}</div>
  </div>`;
}

function renderHome(): void {
  setPageMeta(copy.meta.title, copy.meta.description);
  const featureCards = copy.features.items
    .map((feature) => `<article class="feature-card feature-${escapeHtml(feature.id)}"><div class="feature-card-top"><span class="feature-number">${escapeHtml(feature.number)}</span><span class="feature-mark" aria-hidden="true"></span></div><h3>${escapeHtml(feature.title)}</h3><p>${escapeHtml(feature.description)}</p></article>`)
    .join("");
  const judgePrompts = buildPromptItems(copy.judges.prompts, copy.judges.copyPromptAria, copy.judges.copyAction);

  root.innerHTML = `<a class="skip-link" href="#main">${escapeHtml(copy.nav.skipToContent)}</a>
    <div class="site-shell">
      <header class="site-header"><a class="brand" href="/" aria-label="${escapeHtml(copy.nav.brandHomeAria)}"><span class="brand-mark" aria-hidden="true">U</span><span>${escapeHtml(copy.nav.brand)}</span></a><nav class="site-nav" aria-label="${escapeHtml(copy.nav.mainNavigationLabel)}"><a href="#features">${escapeHtml(copy.nav.features)}</a><a href="#for-judges">${escapeHtml(copy.nav.judges)}</a><a href="#privacy">${escapeHtml(copy.nav.privacy)}</a></nav><a class="button button-primary header-cta" href="/app/">${escapeHtml(copy.nav.tryIt)}${icon("arrow")}</a></header>
      <main id="main">
        <section class="hero-section" aria-labelledby="hero-title"><div class="hero-copy"><p class="eyebrow">${escapeHtml(copy.home.eyebrow)}</p><h1 id="hero-title">${escapeHtml(copy.home.headline)}</h1><p class="hero-intro">${escapeHtml(copy.home.intro)}</p><div class="hero-actions"><a class="button button-primary" href="/app/">${escapeHtml(copy.home.primaryAction)}${icon("arrow")}</a><a class="text-link" href="#features">${escapeHtml(copy.home.secondaryAction)}</a></div><p class="hero-note">${escapeHtml(copy.features.motionNote)}</p></div><div class="hero-preview">${renderWorkspacePreview()}</div></section>
        <section class="video-section section-frame" aria-labelledby="video-title"><div class="section-copy"><p class="eyebrow">${escapeHtml(copy.home.videoEyebrow)}</p><h2 id="video-title">${escapeHtml(copy.home.videoHeading)}</h2><p>${escapeHtml(copy.home.videoIntro)}</p></div><div class="video-slot"><video id="demo-video" controls playsinline preload="none" aria-label="${escapeHtml(copy.home.videoAccessibleLabel)}" hidden></video><div id="video-empty" class="video-empty"><span class="video-mark" aria-hidden="true"></span><div><strong>${escapeHtml(copy.home.videoEmptyTitle)}</strong><p>${escapeHtml(copy.home.videoEmptyCopy)}</p></div></div></div></section>
        <section id="features" class="features-section section-frame" aria-labelledby="features-title"><div class="section-heading"><div><p class="eyebrow">${escapeHtml(copy.features.eyebrow)}</p><h2 id="features-title">${escapeHtml(copy.features.title)}</h2></div><p>${escapeHtml(copy.features.intro)}</p></div><div class="feature-grid">${featureCards}</div></section>
        <section id="for-judges" class="judges-section section-frame" aria-labelledby="judges-title"><div class="section-heading"><div><p class="eyebrow">${escapeHtml(copy.judges.eyebrow)}</p><h2 id="judges-title">${escapeHtml(copy.judges.title)}</h2></div><p>${escapeHtml(copy.judges.intro)}</p></div><div class="judges-grid"><div class="prompt-card"><div class="prompt-card-heading"><h3>${escapeHtml(copy.judges.promptLabel)}</h3><p class="copy-status" id="home-copy-status" role="status" aria-live="polite"></p></div><ol class="prompt-list">${judgePrompts}</ol></div><aside class="failure-card"><span class="failure-mark" aria-hidden="true"></span><h3>${escapeHtml(copy.judges.failureTitle)}</h3><p>${escapeHtml(copy.judges.failureCopy)}</p><a class="text-link" href="/app/">${escapeHtml(copy.judges.action)}${icon("arrow")}</a></aside></div></section>
        <section id="privacy" class="privacy-section section-frame" aria-labelledby="privacy-title"><div class="privacy-main"><p class="eyebrow">${escapeHtml(copy.privacy.eyebrow)}</p><h2 id="privacy-title">${escapeHtml(copy.privacy.title)}</h2><p>${escapeHtml(copy.privacy.copy)}</p></div><div class="privacy-context"><h3>${escapeHtml(copy.privacy.contextTitle)}</h3><p>${escapeHtml(copy.privacy.contextCopy)}</p></div></section>
        <section class="credits-section section-frame" aria-labelledby="credits-title"><div><p class="eyebrow">${escapeHtml(copy.credits.title)}</p><h2 id="credits-title">${escapeHtml(copy.credits.heading)}</h2><p>${escapeHtml(copy.credits.copy)}</p></div><a class="text-link" href="${escapeHtml(copy.links.figcraft)}" target="_blank" rel="noopener noreferrer">${escapeHtml(copy.credits.figcraftLinkLabel)}${icon("external")}</a></section>
      </main>
      <footer class="site-footer"><div class="footer-event"><span class="brand-mark" aria-hidden="true">U</span><p>${escapeHtml(copy.footer.hackathonLabel)}</p></div><div class="footer-links"><a href="${escapeHtml(copy.links.github)}" target="_blank" rel="noopener noreferrer">${escapeHtml(copy.footer.githubLabel)}${icon("external")}</a><a href="${escapeHtml(copy.links.hackathon)}" target="_blank" rel="noopener noreferrer">${escapeHtml(copy.footer.eventLabel)}${icon("external")}</a><span>${escapeHtml(copy.footer.licenseLabel)}</span></div></footer>
    </div>`;

  const status = document.querySelector<HTMLElement>("#home-copy-status");
  if (status) attachCopyActions(status, copy.judges.copySuccess, copy.judges.copyFailure);
  loadDemoVideo();
}

async function loadDemoVideo(): Promise<void> {
  const video = document.querySelector<HTMLVideoElement>("#demo-video");
  const emptyState = document.querySelector<HTMLElement>("#video-empty");
  if (!video || !emptyState) return;

  try {
    const response = await fetch("/demo.mp4", { method: "HEAD", cache: "no-store" });
    const contentType = response.headers.get("content-type") ?? "";
    if (response.ok && (contentType.includes("video/") || contentType.includes("application/octet-stream"))) {
      const source = document.createElement("source");
      source.src = "/demo.mp4";
      source.type = "video/mp4";
      video.append(source);
      video.load();
      video.hidden = false;
      emptyState.hidden = true;
    }
  } catch {
    // A missing optional video leaves the designed empty state in place.
  }
}

function hasRequiredBrowserSupport(): boolean {
  const canvas = document.createElement("canvas");
  const webAssemblyReady = typeof WebAssembly !== "undefined" && typeof WebAssembly.instantiate === "function";
  let webglReady = false;
  try {
    webglReady = canvas.getContext("webgl2") !== null;
  } catch {
    webglReady = false;
  }
  const webgpuReady = "gpu" in navigator && Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
  return webAssemblyReady && (webglReady || webgpuReady);
}

function renderEditorStub(): string {
  const properties = copy.app.previewLayerProperties;
  const markers = copy.app.previewTimelineMarkers.map((label) => `<span>${escapeHtml(label)}</span>`).join("");
  const layerRows = copy.app.previewLayerNames
    .map((name, index) => `<div class="stub-layer"><span class="layer-marker" aria-hidden="true"></span><span>${escapeHtml(name)}</span></div><div class="stub-track"><span>${escapeHtml(properties[index] ?? properties[0])}</span><i class="stub-track-line"><b class="stub-diamond"></b></i></div>`)
    .join("");
  return `<div class="editor-stub" role="img" aria-label="${escapeHtml(copy.app.stubCanvasLabel)}"><div class="stub-toolbar"><span class="stub-project-mark" aria-hidden="true">U</span><strong>${escapeHtml(copy.app.previewProject)}</strong><div class="stub-toolbar-tabs"><span>${escapeHtml(copy.app.previewTabDesign)}</span><span>${escapeHtml(copy.app.previewTabPrototype)}</span><span class="selected">${escapeHtml(copy.app.previewTabMotion)}</span></div></div><div class="stub-editor"><aside class="stub-left"><strong>${escapeHtml(copy.home.previewFolderHeading)}</strong><span class="stub-layer-selected">${escapeHtml(copy.app.previewLayerGroup)}</span>${copy.app.previewLayerNames.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</aside><section class="stub-workarea"><div class="stub-artboard"><div class="stub-artboard-head"><strong>${escapeHtml(copy.app.previewProject)}</strong><span>${escapeHtml(copy.app.previewLayerGroup)}</span></div><div class="stub-artboard-content"><div><h3>${escapeHtml(copy.app.previewCanvasTitle)}</h3><p>${escapeHtml(copy.app.previewCanvasCopy)}</p><span class="stub-continue">${escapeHtml(copy.app.previewCanvasButton)}</span></div><div class="stub-mini-chart" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div></div><div class="stub-stats"><span></span><span></span><span></span></div></div><div class="stub-floating-tools" aria-hidden="true"><span class="toolbar-tool"></span><span class="toolbar-tool"></span><span class="toolbar-tool"></span><b>${escapeHtml(copy.app.previewTabMotion)}</b></div></section><aside class="stub-properties"><strong>${escapeHtml(copy.app.previewSidebarTitle)}</strong><span>${escapeHtml(copy.app.previewComposition)}</span><span>${escapeHtml(copy.app.previewSelectedLayer)}</span><span>${escapeHtml(copy.app.previewDuration)}</span><span>${escapeHtml(copy.app.previewEasing)}</span></aside></div><div class="stub-timeline"><div class="stub-timeline-head"><strong>${escapeHtml(copy.app.previewTimelineTitle)}</strong>${markers}</div>${layerRows}</div></div>`;
}

function buildAppShell(): void {
  setPageMeta(copy.app.title, copy.meta.description);
  root.innerHTML = `<div class="app-shell" id="app-shell"><header class="app-header"><a class="app-brand" href="/" aria-label="${escapeHtml(copy.nav.brand)}"><span class="brand-mark" aria-hidden="true">U</span><span><strong>${escapeHtml(copy.app.title)}</strong><small>${escapeHtml(copy.app.subtitle)}</small></span></a><a class="app-back" href="/">${escapeHtml(copy.app.backToShowcase)}${icon("arrow")}</a></header><main class="app-main"><div class="app-stage" id="app-stage"><section class="app-loading" id="app-loading" role="status" aria-live="polite"><div class="loading-spinner" aria-hidden="true"></div><strong>${escapeHtml(copy.app.loadingTitle)}</strong><p>${escapeHtml(copy.app.loadingCopy)}</p><div class="loading-track" role="progressbar" aria-label="${escapeHtml(copy.app.loadingAccessible)}"><span></span></div></section><section class="app-message" id="app-message" hidden><h1></h1><p></p><a class="button button-secondary" href="/">${escapeHtml(copy.app.backToShowcase)}</a></section><section class="app-content" id="app-content" hidden></section></div></main><button class="judge-float-toggle" id="judge-float-toggle" type="button" aria-controls="judge-panel" aria-expanded="false" hidden>${escapeHtml(copy.app.judgesButton)}</button><aside class="judge-panel" id="judge-panel" aria-labelledby="judge-panel-title" hidden><div class="judge-panel-head"><div><p class="eyebrow">${escapeHtml(copy.judges.eyebrow)}</p><h2 id="judge-panel-title">${escapeHtml(copy.app.judgePanelTitle)}</h2><p>${escapeHtml(copy.app.judgePanelIntro)}</p></div><button class="icon-button judge-panel-close" id="judge-panel-close" type="button" aria-label="${escapeHtml(copy.app.judgePanelClose)}">${icon("close")}</button></div><ol class="prompt-list app-prompt-list">${buildPromptItems(copy.judges.prompts, copy.app.copyPromptAria, copy.app.copyAction)}</ol><p class="copy-status" id="app-copy-status" role="status" aria-live="polite"></p><div class="provider-note"><strong>${escapeHtml(copy.app.providerTitle)}</strong><p>${escapeHtml(copy.app.providerCopy)}</p></div></aside></div>`;

  const loading = document.querySelector<HTMLElement>("#app-loading");
  const message = document.querySelector<HTMLElement>("#app-message");
  const content = document.querySelector<HTMLElement>("#app-content");
  const appShell = document.querySelector<HTMLElement>("#app-shell");
  const toggle = document.querySelector<HTMLButtonElement>("#judge-float-toggle");
  const panel = document.querySelector<HTMLElement>("#judge-panel");
  const close = document.querySelector<HTMLButtonElement>("#judge-panel-close");
  if (!loading || !message || !content || !appShell || !toggle || !panel || !close) return;

  const showMessage = (title: string, detail: string): void => {
    loading.hidden = true;
    content.hidden = true;
    message.hidden = false;
    const heading = message.querySelector("h1");
    const paragraph = message.querySelector("p");
    if (heading) heading.textContent = title;
    if (paragraph) paragraph.textContent = detail;
  };

  if (window.matchMedia("(max-width: 900px)").matches) {
    showMessage(copy.app.desktopTitle, copy.app.desktopCopy);
    return;
  }

  window.setTimeout(async () => {
    const runtimeHtml = await findInstalledRuntime();
    if (runtimeHtml && !hasRequiredBrowserSupport()) {
      showMessage(copy.app.unsupportedTitle, copy.app.unsupportedCopy);
      return;
    }
    const runtimeUrl = new URL("/app/runtime.html", window.location.origin);
    if (new URLSearchParams(window.location.search).has("webgl")) {
      runtimeUrl.searchParams.set("webgl", "");
    }
    const runtimePath = `${runtimeUrl.pathname}${runtimeUrl.search}`;
    loading.hidden = true;
    content.hidden = false;
    appShell.classList.add("app-shell-ready");
    toggle.hidden = false;
    content.innerHTML = runtimeHtml
      ? `<iframe class="runtime-frame" src="${escapeHtml(runtimePath)}" title="${escapeHtml(copy.app.title)}" allow="fullscreen"></iframe>`
      : `<div class="stub-banner"><div><span class="status-badge">${escapeHtml(copy.app.stubBadge)}</span><h1>${escapeHtml(copy.app.stubTitle)}</h1><p>${escapeHtml(copy.app.stubCopy)}</p><p class="stub-note">${escapeHtml(copy.app.noRuntime)}</p></div></div>${renderEditorStub()}`;

    const frame = content.querySelector<HTMLIFrameElement>(".runtime-frame");
    frame?.addEventListener("load", () => {
      const hasRuntimeMarker = frame.contentDocument?.querySelector('meta[name="undesign-runtime"][content="true"]');
      if (!hasRuntimeMarker) {
        content.innerHTML = `<p class="runtime-error" role="alert">${escapeHtml(copy.app.runtimeLoadError)}</p>`;
      }
    });

    const status = document.querySelector<HTMLElement>("#app-copy-status");
    if (status) attachCopyActions(status, copy.app.copySuccess, copy.app.copyFailure);
    toggle.addEventListener("click", () => {
      appShell.classList.add("judges-open");
      panel.hidden = false;
      toggle.hidden = true;
      toggle.setAttribute("aria-expanded", "true");
      close.focus();
    });
    close.addEventListener("click", () => {
      appShell.classList.remove("judges-open");
      panel.hidden = true;
      toggle.hidden = false;
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus();
    });
  }, 320);
}

async function findInstalledRuntime(): Promise<boolean> {
  try {
    const response = await fetch("/app/runtime.html", { cache: "no-store" });
    if (!response.ok) return false;
    const html = await response.text();
    return html.includes('name="undesign-runtime" content="true"');
  } catch {
    return false;
  }
}

function renderCurrentRoute(): void {
  if (window.location.pathname === "/app" || window.location.pathname.startsWith("/app/")) {
    buildAppShell();
  } else {
    renderHome();
  }
}

renderCurrentRoute();
