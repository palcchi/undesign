const status = document.querySelector("#status");
const dialog = document.querySelector(".contact-dialog");
let lastContactTrigger = null;

for (const button of document.querySelectorAll("[data-follow]")) {
  button.addEventListener("click", () => {
    const following = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(following));
    button.textContent = following ? "Following" : "Follow";
    status.textContent = following ? "Following Olivia Rhye." : "You are no longer following Olivia Rhye.";
  });
}

for (const button of document.querySelectorAll("[data-save]")) {
  button.addEventListener("click", () => {
    const saved = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(saved));
    button.setAttribute("aria-label", saved ? "Remove Olivia Rhye's profile from saved profiles" : "Save Olivia Rhye's profile");
    status.textContent = saved ? "Olivia Rhye's profile saved." : "Olivia Rhye's profile removed from saved profiles.";
  });
}

for (const button of document.querySelectorAll("[data-contact]")) {
  button.addEventListener("click", () => {
    lastContactTrigger = button;
    dialog.showModal();
  });
}

for (const button of dialog.querySelectorAll(".dialog-close, .dialog-done")) {
  button.addEventListener("click", () => dialog.close());
}

dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

dialog.addEventListener("close", () => {
  lastContactTrigger?.focus();
});
