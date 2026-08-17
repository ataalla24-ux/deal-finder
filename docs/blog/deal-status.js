(function () {
  "use strict";

  function hasExpired(value) {
    const timestamp = Date.parse(String(value || ""));
    return Number.isFinite(timestamp) && timestamp < Date.now();
  }

  function markExpiredCard(card) {
    card.classList.add("is-expired");
    const label = card.querySelector(".topic-label");
    if (label) label.textContent = "Aktion beendet";
    const grid = card.parentElement;
    if (grid) grid.appendChild(card);
  }

  function markExpiredPage(page) {
    document.body.classList.add("deal-is-expired");
    const eyebrow = page.querySelector(".eyebrow");
    if (eyebrow) eyebrow.textContent = "Aktion beendet";
    const banner = page.querySelector("[data-deal-status-banner]");
    if (banner) banner.hidden = false;
  }

  function initialize() {
    document.querySelectorAll("[data-deal-expires]").forEach(function (element) {
      if (!hasExpired(element.getAttribute("data-deal-expires"))) return;
      if (element.matches(".post-card")) markExpiredCard(element);
      if (element.matches("[data-deal-page]")) markExpiredPage(element);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
