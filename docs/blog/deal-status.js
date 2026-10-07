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
    if (!document.title.includes("(Archiv)")) {
      document.title = document.title.replace(/\s*\|\s*FreeFinder$/, "") + " (Archiv) | FreeFinder";
      const description = "Diese Aktion ist beendet. Damalige Bedingungen im Archiv; aktuelle Wiener Angebote findest du in unserer Deal-Übersicht.";
      document.querySelectorAll('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]').forEach(meta => meta.setAttribute("content", description));
      document.querySelectorAll('meta[property="og:title"], meta[name="twitter:title"]').forEach(meta => meta.setAttribute("content", document.title));
    }
  }

  function initialize() {
    document.querySelectorAll("[data-deal-expires]").forEach(function (element) {
      if (!hasExpired(element.getAttribute("data-deal-expires"))) return;
      if (element.matches(".post-card")) markExpiredCard(element);
      if (element.matches("[data-deal-page]")) markExpiredPage(element);
    });
    const filters = document.getElementById("blogFilters");
    if (!filters) return;
    const search = document.getElementById("blogSearch");
    const topic = document.getElementById("blogTopic");
    const archive = document.getElementById("blogArchive");
    const status = document.getElementById("blogResults");
    const normalize = value => String(value).toLocaleLowerCase("de-AT").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u").replace(/ß/g, "ss");
    const cards = Array.from(document.querySelectorAll(".post-card")).map(card => ({ card, text: normalize(card.textContent) }));
    function filterCards() {
      const terms = normalize(search.value).trim().split(/\s+/).filter(Boolean);
      let visible = 0;
      cards.forEach(({ card, text }) => {
        const archived = card.dataset.archive === "true" || card.classList.contains("is-expired");
        card.hidden = (!archive.checked && archived) || (topic.value && card.dataset.topic !== topic.value) || !terms.every(term => text.includes(term));
        if (!card.hidden) visible++;
      });
      status.textContent = visible ? `${visible} ${visible === 1 ? "Beitrag" : "Beiträge"}${archive.checked ? " einschließlich Archiv" : " ohne beendete Aktionen"}` : "Keine passenden Beiträge. Ändere die Suche, das Thema oder die Archivauswahl.";
    }
    filters.hidden = false;
    filters.addEventListener("submit", event => event.preventDefault());
    search.addEventListener("input", filterCards);
    topic.addEventListener("change", filterCards);
    archive.addEventListener("change", filterCards);
    filterCards();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
