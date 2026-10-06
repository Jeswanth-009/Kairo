/* Small enhancements only. The page, navigation, and release links work without JavaScript. */
(function () {
  "use strict";

  var toggle = document.querySelector(".menu-toggle");
  var menu = document.getElementById("mobile-menu");

  function closeMenu() {
    if (!toggle || !menu) return;
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open menu");
  }

  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      var opening = menu.hidden;
      menu.hidden = !opening;
      toggle.setAttribute("aria-expanded", String(opening));
      toggle.setAttribute("aria-label", opening ? "Close menu" : "Open menu");
    });
    menu.addEventListener("click", function (event) {
      if (event.target.closest("a")) closeMenu();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeMenu();
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 800) closeMenu();
    });
  }

  // The checked-in v5 link remains useful if GitHub's API is unavailable.
  fetch("https://api.github.com/repos/Jeswanth-009/Kairo/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then(function (response) {
      if (!response.ok) throw new Error("Release request failed");
      return response.json();
    })
    .then(function (release) {
      if (!release || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) return;
      ["hero-version", "dl-version"].forEach(function (id) {
        var label = document.getElementById(id);
        if (label) label.textContent = release.tag_name;
      });
      var installer = (release.assets || []).find(function (asset) {
        return /^Kairo_\d+\.\d+\.\d+_x64-setup\.exe$/.test(asset.name);
      });
      if (!installer || !installer.browser_download_url) return;
      ["hero-download", "download-btn"].forEach(function (id) {
        var link = document.getElementById(id);
        if (link) link.href = installer.browser_download_url;
      });
    })
    .catch(function () {
      /* Keep the release-page fallback. */
    });
})();
