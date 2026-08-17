(function () {
  "use strict";

  const STORAGE_KEY = "freefinder_analytics_consent_v1";
  const config = window.FreeFinderTrackingConfig || {};
  let gtmLoaded = false;
  let clarityLoaded = false;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () {
    window.dataLayer.push(arguments);
  };

  function googleConsent(value, mode) {
    window.gtag("consent", mode, {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: value,
      functionality_storage: "granted",
      security_storage: "granted"
    });
  }

  googleConsent("denied", "default");

  function readConsent() {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      return value === "granted" || value === "denied" ? value : null;
    } catch (_) {
      return null;
    }
  }

  function saveConsent(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (_) {
      // Consent still applies for the current page if storage is unavailable.
    }
  }

  function clearAnalyticsCookies() {
    const names = document.cookie
      .split(";")
      .map(function (cookie) { return cookie.split("=")[0].trim(); })
      .filter(function (name) {
        return /^_ga(?:_|$)|^_cl(?:ck|sk)$/.test(name);
      });
    const domains = ["", window.location.hostname, ".freefinder.at"];
    names.forEach(function (name) {
      domains.forEach(function (domain) {
        document.cookie = name + "=; Max-Age=0; path=/; SameSite=Lax" + (domain ? "; domain=" + domain : "");
      });
    });
  }

  function loadGtm() {
    const id = String(config.gtmId || "").trim();
    if (gtmLoaded || !/^GTM-[A-Z0-9]+$/i.test(id)) return;
    gtmLoaded = true;
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(id);
    document.head.appendChild(script);
  }

  function clarityConsent(value) {
    if (typeof window.clarity !== "function") return;
    window.clarity("consentv2", {
      ad_Storage: "denied",
      analytics_Storage: value
    });
    if (value === "denied") window.clarity("consent", false);
  }

  function loadClarity() {
    const id = String(config.clarityId || "").trim();
    if (clarityLoaded || !/^[a-z0-9]+$/i.test(id)) return;
    clarityLoaded = true;
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () {
        (c[a].q = c[a].q || []).push(arguments);
      };
      t = l.createElement(r);
      t.async = 1;
      t.src = "https://www.clarity.ms/tag/" + i;
      y = l.getElementsByTagName(r)[0];
      y.parentNode.insertBefore(t, y);
    })(window, document, "clarity", "script", id);
    clarityConsent("granted");
  }

  function applyConsent(value) {
    const normalized = value === "granted" ? "granted" : "denied";
    saveConsent(normalized);
    googleConsent(normalized, "update");
    if (normalized === "granted") {
      loadGtm();
      loadClarity();
      window.dataLayer.push({ event: "freefinder_analytics_consent_granted" });
    } else {
      clarityConsent("denied");
      clearAnalyticsCookies();
      window.dataLayer.push({ event: "freefinder_analytics_consent_denied" });
    }
    hideBanner();
  }

  function hideBanner() {
    const banner = document.getElementById("ffCookieBanner");
    if (banner) banner.hidden = true;
    const manage = document.getElementById("ffCookieManage");
    if (manage) manage.hidden = false;
  }

  function showBanner(showSettings) {
    const banner = document.getElementById("ffCookieBanner");
    if (!banner) return;
    const manage = document.getElementById("ffCookieManage");
    const settings = banner.querySelector(".ff-cookie-settings");
    const analytics = banner.querySelector("#ffCookieAnalytics");
    banner.hidden = false;
    if (manage) manage.hidden = true;
    settings.classList.toggle("is-open", Boolean(showSettings));
    analytics.checked = readConsent() === "granted";
    banner.querySelector(".ff-cookie-title").focus();
  }

  function buildBanner() {
    if (document.getElementById("ffCookieBanner")) return;
    const banner = document.createElement("section");
    banner.id = "ffCookieBanner";
    banner.className = "ff-cookie-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-modal", "false");
    banner.setAttribute("aria-labelledby", "ffCookieTitle");
    banner.innerHTML = [
      '<div class="ff-cookie-inner">',
      '<h2 class="ff-cookie-title" id="ffCookieTitle" tabindex="-1">Deine Cookie-Auswahl</h2>',
      '<p class="ff-cookie-copy">Wir verwenden optionale Analyse-Cookies erst nach deiner Zustimmung. Damit sehen wir, welche Seiten hilfreich sind und wo die Website verbessert werden kann. <a href="/privacy.html">Datenschutz ansehen</a>.</p>',
      '<div class="ff-cookie-settings" aria-label="Cookie-Kategorien">',
      '<label class="ff-cookie-option"><span><strong>Notwendig</strong><span>Speichert nur deine Auswahl und technisch erforderliche Einstellungen.</span></span><input type="checkbox" checked disabled aria-label="Notwendige Speicherung immer aktiv"></label>',
      '<label class="ff-cookie-option"><span><strong>Analyse</strong><span>Google Analytics und Microsoft Clarity zur pseudonymisierten Nutzungsanalyse.</span></span><input id="ffCookieAnalytics" type="checkbox" aria-label="Analyse zulassen"></label>',
      '</div>',
      '<div class="ff-cookie-actions">',
      '<button class="ff-cookie-button" type="button" data-cookie-action="deny">Ablehnen</button>',
      '<button class="ff-cookie-button" type="button" data-cookie-action="settings">Einstellungen</button>',
      '<button class="ff-cookie-button ff-cookie-button--primary" type="button" data-cookie-action="save" hidden>Auswahl speichern</button>',
      '<button class="ff-cookie-button ff-cookie-button--accent" type="button" data-cookie-action="accept">Alle akzeptieren</button>',
      '</div>',
      '</div>'
    ].join("");
    document.body.appendChild(banner);

    const manage = document.createElement("button");
    manage.id = "ffCookieManage";
    manage.className = "ff-cookie-manage";
    manage.type = "button";
    manage.textContent = "Cookie-Einstellungen";
    manage.hidden = true;
    manage.addEventListener("click", function () {
      window.openFreeFinderCookieSettings();
    });
    document.body.appendChild(manage);

    banner.addEventListener("click", function (event) {
      const button = event.target.closest("[data-cookie-action]");
      if (!button) return;
      const action = button.getAttribute("data-cookie-action");
      if (action === "deny") applyConsent("denied");
      if (action === "accept") applyConsent("granted");
      if (action === "settings") {
        banner.querySelector(".ff-cookie-settings").classList.add("is-open");
        banner.querySelector('[data-cookie-action="settings"]').hidden = true;
        banner.querySelector('[data-cookie-action="save"]').hidden = false;
      }
      if (action === "save") {
        applyConsent(banner.querySelector("#ffCookieAnalytics").checked ? "granted" : "denied");
      }
    });
  }

  function initialize() {
    buildBanner();
    const saved = readConsent();
    if (saved === "granted") {
      googleConsent("granted", "update");
      loadGtm();
      loadClarity();
      hideBanner();
    } else if (saved === "denied") {
      hideBanner();
    } else {
      showBanner(false);
    }
  }

  window.openFreeFinderCookieSettings = function () {
    showBanner(true);
    const banner = document.getElementById("ffCookieBanner");
    if (banner) {
      banner.querySelector('[data-cookie-action="settings"]').hidden = true;
      banner.querySelector('[data-cookie-action="save"]').hidden = false;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
