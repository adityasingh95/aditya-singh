(() => {
  if (!("fetch" in window) || !("DOMParser" in window) || !("history" in window) || !("pushState" in history)) {
    return;
  }

  const getShell = () => document.body.firstElementChild;
  const getCurrentMetaDescription = () => document.querySelector('meta[name="description"]');

  const injectTransitionStyles = () => {
    if (document.getElementById("spa-nav-style")) return;
    const style = document.createElement("style");
    style.id = "spa-nav-style";
    style.textContent = `
      body > div {
        transition: opacity 180ms ease, transform 180ms ease;
      }
      body > div.spa-transitioning {
        opacity: 0.86;
        transform: translateY(2px);
        pointer-events: none;
      }
      @media (prefers-reduced-motion: reduce) {
        body > div {
          transition: none;
        }
      }
    `;
    document.head.appendChild(style);
  };

  const enhanceHeader = () => {
    const header = document.querySelector("body > div > header");
    if (!header) return;
    header.classList.add(
      "sticky",
      "top-0",
      "z-50",
      "bg-stone-50/90",
      "backdrop-blur",
      "supports-[backdrop-filter]:bg-stone-50/75"
    );
  };

  const saveScrollPosition = () => {
    try {
      const nextState = { ...(history.state || {}), scrollY: window.scrollY };
      history.replaceState(nextState, "", window.location.href);
    } catch (_error) {
      // no-op
    }
  };

  const isModifiedClick = (event) => {
    return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
  };

  const shouldHandleLink = (link, event) => {
    if (!link || event.defaultPrevented || isModifiedClick(event)) return false;
    if (link.target && link.target !== "_self") return false;
    if (link.hasAttribute("download")) return false;

    const rawHref = link.getAttribute("href");
    if (!rawHref || rawHref.startsWith("#")) return false;
    if (rawHref.startsWith("mailto:") || rawHref.startsWith("tel:") || rawHref.startsWith("javascript:")) {
      return false;
    }

    const targetUrl = new URL(link.href, window.location.href);
    if (targetUrl.origin !== window.location.origin) return false;

    const samePath = targetUrl.pathname === window.location.pathname && targetUrl.search === window.location.search;
    if (samePath && targetUrl.hash) return false;

    return true;
  };

  const scrollToTarget = (hash, fallbackY = 0) => {
    if (!hash) {
      window.scrollTo({ top: fallbackY, left: 0, behavior: "auto" });
      return;
    }

    const decodedId = decodeURIComponent(hash.slice(1));
    const target = document.getElementById(decodedId) || document.querySelector(hash);
    if (target) {
      target.scrollIntoView({ behavior: "auto", block: "start" });
    } else {
      window.scrollTo({ top: fallbackY, left: 0, behavior: "auto" });
    }
  };

  const refreshEmbeds = () => {
    if (window.Tally && typeof window.Tally.loadEmbeds === "function") {
      window.Tally.loadEmbeds();
    }
  };

  let isNavigating = false;

  const navigate = async (url, options = {}) => {
    const { push = true, restoreScroll = 0 } = options;
    const targetUrl = new URL(url, window.location.href);
    const shell = getShell();

    if (!shell || isNavigating) {
      window.location.href = targetUrl.href;
      return;
    }

    isNavigating = true;
    saveScrollPosition();
    shell.classList.add("spa-transitioning");

    try {
      const response = await fetch(targetUrl.href, {
        headers: {
          "X-Requested-With": "spa-nav",
        },
      });

      if (!response.ok) {
        throw new Error(`Navigation failed with status ${response.status}`);
      }

      const html = await response.text();
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const nextShell = parsed.body.firstElementChild;
      if (!nextShell) {
        throw new Error("Unable to find next page shell");
      }

      const nextMeta = parsed.querySelector('meta[name="description"]');
      const currentMeta = getCurrentMetaDescription();

      shell.innerHTML = nextShell.innerHTML;
      document.title = parsed.title || document.title;
      if (nextMeta && currentMeta) {
        currentMeta.setAttribute("content", nextMeta.getAttribute("content") || "");
      }

      if (push) {
        history.pushState({ scrollY: 0 }, "", `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
      }

      requestAnimationFrame(() => {
        enhanceHeader();
        shell.classList.remove("spa-transitioning");
        scrollToTarget(targetUrl.hash, push ? 0 : restoreScroll);
        refreshEmbeds();
      });
    } catch (_error) {
      window.location.href = targetUrl.href;
      return;
    } finally {
      isNavigating = false;
    }
  };

  injectTransitionStyles();
  enhanceHeader();
  if (!history.state || typeof history.state.scrollY !== "number") {
    saveScrollPosition();
  }

  let scrollTicking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollTicking || isNavigating) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        scrollTicking = false;
        saveScrollPosition();
      });
    },
    { passive: true }
  );

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!shouldHandleLink(link, event)) return;
    event.preventDefault();
    navigate(link.href, { push: true, restoreScroll: 0 });
  });

  window.addEventListener("popstate", (event) => {
    navigate(window.location.href, {
      push: false,
      restoreScroll: typeof event.state?.scrollY === "number" ? event.state.scrollY : 0,
    });
  });
})();
