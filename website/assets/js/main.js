/* Kairo website — progressive enhancement.
   Everything works without this file; it adds scroll reveals, the mobile
   menu, and live GitHub data (latest release, star count). */

(function () {
  "use strict";

  var REPO = "Jeswanth-009/Kairo";

  /* ---------------------------- Nav scroll state ---------------------------- */

  var nav = document.querySelector(".nav");
  var onScroll = function () {
    nav.classList.toggle("scrolled", window.scrollY > 8);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ------------------------------ Mobile menu ------------------------------ */

  var toggle = document.querySelector(".nav-toggle");
  var menu = document.getElementById("mobile-menu");
  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      var open = menu.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        menu.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* --------------------------- Reveal on scroll ---------------------------- */

  var revealables = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!("IntersectionObserver" in window) || reduceMotion) {
    revealables.forEach(function (el) { el.classList.add("in"); });
  } else {
    // Stagger siblings that become visible in the same frame.
    var observer = new IntersectionObserver(
      function (entries) {
        var delay = 0;
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          el.style.transitionDelay = (delay * 70) + "ms";
          delay += 1;
          el.classList.add("in");
          observer.unobserve(el);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealables.forEach(function (el) { observer.observe(el); });
  }

  /* ------------------------- Live GitHub release data ---------------------- */
  /* Falls back to the baked-in version if the API is unreachable. */

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  fetch("https://api.github.com/repos/" + REPO + "/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then(function (res) { return res.ok ? res.json() : Promise.reject(res.status); })
    .then(function (release) {
      if (!release || !release.tag_name) return;
      var version = release.tag_name;
      setText("hero-version", version);
      setText("dl-version", version);
      setText("dl-fact-version", version);

      var asset = (release.assets || []).find(function (a) {
        return /x64-setup\.exe$/.test(a.name);
      });
      var link = document.getElementById("download-btn");
      if (asset && link) link.href = asset.browser_download_url;
      var heroLink = document.getElementById("hero-download");
      if (asset && heroLink) heroLink.href = asset.browser_download_url;
    })
    .catch(function () { /* static fallbacks already in place */ });

  fetch("https://api.github.com/repos/" + REPO, {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then(function (res) { return res.ok ? res.json() : Promise.reject(res.status); })
    .then(function (repo) {
      if (typeof repo.stargazers_count === "number") {
        setText("gh-stars", "★ " + repo.stargazers_count.toLocaleString("en-US"));
      }
    })
    .catch(function () { /* dash placeholder stays */ });
})();
