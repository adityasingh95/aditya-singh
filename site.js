(() => {
  if (!("fetch" in window) || !("DOMParser" in window) || !("history" in window) || !("pushState" in history)) {
    return;
  }

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const getShell = () => document.body.firstElementChild;
  const getCurrentMetaDescription = () => document.querySelector('meta[name="description"]');
  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const injectTransitionStyles = () => {
    if (document.getElementById("spa-nav-style")) return;
    const style = document.createElement("style");
    style.id = "spa-nav-style";
    style.textContent = `
      body > div {
        transition: opacity 320ms cubic-bezier(0.22, 1, 0.36, 1), transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
        will-change: opacity, transform;
      }
      body > div.spa-transitioning-out {
        opacity: 0.82;
        transform: translateY(-14px);
        pointer-events: none;
      }
      body > div.spa-transitioning-in {
        opacity: 0;
        transform: translateY(18px);
        pointer-events: none;
      }
      @media (prefers-reduced-motion: reduce) {
        html {
          scroll-behavior: auto;
        }
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

    const brandLink = header.querySelector("a");
    if (brandLink) {
      brandLink.textContent = "Home";
      brandLink.setAttribute("aria-label", "Go to home");
    }
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

  const scrollToTarget = (hash, fallbackY = 0, behavior = "auto") => {
    if (!hash) {
      window.scrollTo({ top: fallbackY, left: 0, behavior });
      return false;
    }

    const decodedId = decodeURIComponent(hash.slice(1));
    const target = document.getElementById(decodedId) || document.querySelector(hash);
    if (target) {
      target.scrollIntoView({ behavior, block: "start" });
      return true;
    }

    window.scrollTo({ top: fallbackY, left: 0, behavior });
    return false;
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

    const responsePromise = fetch(targetUrl.href, {
      headers: {
        "X-Requested-With": "spa-nav",
      },
    });

    if (!prefersReducedMotion) {
      shell.classList.remove("spa-transitioning-in");
      shell.classList.add("spa-transitioning-out");
    }

    try {
      const [response] = await Promise.all([
        responsePromise,
        prefersReducedMotion ? Promise.resolve() : wait(170),
      ]);

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

      enhanceHeader();
      refreshEmbeds();

      if (!prefersReducedMotion) {
        shell.classList.remove("spa-transitioning-out");
        shell.classList.add("spa-transitioning-in");
      }

      scrollToTarget(targetUrl.hash, push ? 0 : restoreScroll, "auto");

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          shell.classList.remove("spa-transitioning-in");
        });
      });
    } catch (_error) {
      window.location.href = targetUrl.href;
      return;
    } finally {
      window.setTimeout(() => {
        isNavigating = false;
      }, prefersReducedMotion ? 0 : 220);
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
    if (!link || event.defaultPrevented || isModifiedClick(event)) return;
    if (link.target && link.target !== "_self") return;
    if (link.hasAttribute("download")) return;

    const rawHref = link.getAttribute("href");
    if (!rawHref) return;
    if (rawHref.startsWith("mailto:") || rawHref.startsWith("tel:") || rawHref.startsWith("javascript:")) return;

    const targetUrl = new URL(link.href, window.location.href);
    if (targetUrl.origin !== window.location.origin) return;

    const sameDocument = targetUrl.pathname === window.location.pathname && targetUrl.search === window.location.search;

    if (sameDocument && targetUrl.hash) {
      event.preventDefault();
      history.pushState({ ...(history.state || {}), scrollY: window.scrollY }, "", `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
      scrollToTarget(targetUrl.hash, window.scrollY, prefersReducedMotion ? "auto" : "smooth");
      return;
    }

    if (sameDocument && !targetUrl.hash) {
      return;
    }

    event.preventDefault();
    navigate(link.href, { push: true, restoreScroll: 0 });
  });

  window.addEventListener("popstate", (event) => {
    const targetUrl = new URL(window.location.href);
    const currentPath = window.location.pathname + window.location.search;
    const statePath = targetUrl.pathname + targetUrl.search;

    if (statePath === currentPath && targetUrl.hash) {
      scrollToTarget(targetUrl.hash, typeof event.state?.scrollY === "number" ? event.state.scrollY : 0, prefersReducedMotion ? "auto" : "smooth");
      return;
    }

    navigate(window.location.href, {
      push: false,
      restoreScroll: typeof event.state?.scrollY === "number" ? event.state.scrollY : 0,
    });
  });
})();
