const mapEl = document.getElementById("map");

mapEl.addEventListener("arcgisViewReadyChange", () => {
  const view = mapEl.view;

  // -----------------------------
  // View defaults
  // -----------------------------
  view.center = [-80.2684, 25.7215];
  view.zoom = 12;
  view.padding = { top: 90, left: 320, right: 20, bottom: 20 };

  document.getElementById("btn-home").onclick = () =>
    view.goTo({ center: [-80.2684, 25.7215], zoom: 12 });
  document.getElementById("btn-zoom-in").onclick = () => (view.zoom += 1);
  document.getElementById("btn-zoom-out").onclick = () => (view.zoom -= 1);

  require(
    [
      "esri/layers/FeatureLayer",
      "esri/geometry/geometryEngine",
      "esri/Graphic",
      "esri/layers/GraphicsLayer",
      "esri/widgets/Sketch",
      "esri/rest/locator",
    ],
    (FeatureLayer, geometryEngine, Graphic, GraphicsLayer, Sketch, locator) => {
      // ============================================================
      // THEME / COLORS
      // ============================================================
      const COLORS = {
        teal: [0, 121, 115, 1],
        tealFill: [0, 121, 115, 0.12],

        cityRed: [220, 0, 0, 0.8],

        addressBlue: "#1976d2", // base layer blue dots

        selectedFill: [25, 118, 210, 1],
        selectedRingRed: [176, 0, 32, 0.85],
        selectedRingWhite: [255, 255, 255, 0.95],
      };

      // ============================================================
      // LAYERS (Graphics)
      // ============================================================
      const drawLayer = new GraphicsLayer(); // sketch/radius graphics
      const selectionLayer = new GraphicsLayer(); // selected points graphics
      view.map.addMany([drawLayer, selectionLayer]);

      // ============================================================
      // STATE
      // ============================================================
      let selectedFeatures = [];
      let allRows = [];
      let filteredRows = [];
      let toastTimer = null;
      let clickMode = "identify"; // "identify" | "radius"

      let selectionMeta = {
        method: "", // "radius" | "draw"
        radiusValue: null, // number
        radiusUnit: "", // "feet" | "meters"
        centerPoint: null, // map point (ArcGIS geometry)
        centerAddress: "", // later: reverse geocode
        selectedCount: 0,
        labelType: "", // "owners" | "residents" | "both"
        createdAt: null, // Date
        drawAreaSqFt: null,
        drawAreaAcres: null,
      };

      let lastSelectionGeometry = null; // ✅ used for print snapshot

      window.selectionMeta = selectionMeta;

      // ============================================================
      // UI REFERENCES
      // ============================================================
      const toastEl = document.getElementById("toast");
      const toastTitleEl = document.getElementById("toast-title");
      const toastSubEl = document.getElementById("toast-sub");

      const floatingBtn = document.getElementById("floating-list-btn");
      const emptyStateEl = document.getElementById("empty-state");

      const downloadBtn = document.getElementById("downloadBtn");
      const downloadMenu = document.getElementById("downloadMenu");
      const downloadCsvBtn = document.getElementById("downloadCsv");
      const downloadXlsxBtn = document.getElementById("downloadXlsx");

      // Legend toggle
      const legendEl = document.getElementById("legend");
      const legendToggle = document.getElementById("legend-toggle");
      legendToggle?.addEventListener("click", (e) => {
        e.stopPropagation();
        legendEl?.classList.toggle("is-collapsed");
      });

      // Help Center modal
      const helpBtn = document.getElementById("help-btn");
      const helpOverlay = document.getElementById("help-overlay");
      const helpClose = document.getElementById("help-close");
      const startTourBtn = document.getElementById("start-tour-btn");
      const openGuideBtn = document.getElementById("open-guide-btn");
      const guideOverlay = document.getElementById("guide-overlay");
      const guideClose = document.getElementById("guide-close");

      // Welcome modal
      const welcomeOverlay = document.getElementById("welcome-overlay");
      const welcomeStart = document.getElementById("welcome-start");
      const welcomeSkip = document.getElementById("welcome-skip");

      // Quick Tour
      const tourOverlay = document.getElementById("tour-overlay");
      const tourCard = document.getElementById("tour-card");
      const tourTitle = document.getElementById("tour-title");
      const tourBody = document.getElementById("tour-body");
      const tourStep = document.getElementById("tour-step");
      const tourExit = document.getElementById("tour-exit");
      const tourBack = document.getElementById("tour-back");
      const tourNext = document.getElementById("tour-next");

      // Draft Labels modal
      const draftFloatingBtn = document.getElementById("draft-btn");
      const draftOverlay = document.getElementById("draft-overlay");
      const draftClose = document.getElementById("draft-close");
      const draftCreate = document.getElementById("draft-create");
      const draftError = document.getElementById("draft-error");

      // Draw menu
      const drawBtn = document.getElementById("draw-btn");
      const drawMenu = document.getElementById("draw-menu");
      const toolArrow = document.getElementById("tool-arrow");
      const toolRect = document.getElementById("tool-rectangle");
      const toolPoly = document.getElementById("tool-polygon");

      // Radius menu
      const radiusBtn = document.getElementById("radius-btn");
      const radiusMenu = document.getElementById("radius-menu");
      const radiusMenuValue = document.getElementById("radiusMenuValue");
      const radiusMenuUnit = document.getElementById("radiusMenuUnit");
      const radiusMenuApply = document.getElementById("radiusMenuApply");

      const radiusInput = document.getElementById("radius");
      const radiusUnitSelect = document.getElementById("radiusUnit");

      // List modal
      const modalOverlay = document.getElementById("modal-overlay");
      const modalClose = document.getElementById("modal-close");
      const modalTbody = document.getElementById("modal-tbody");
      const modalCount = document.getElementById("modal-count");

      // list button should remain clickable even with no selection
      floatingBtn?.classList.add("is-disabled");

      // ============================================================
      // FEATURE LAYERS
      // ============================================================
      const addressLayer = new FeatureLayer({
        url: "https://gisent.coralgables.com/entserver/rest/services/DisplayMap_MIL1/MapServer/1",
        outFields: ["*"],
        popupEnabled: false,
      });

      addressLayer.renderer = {
        type: "simple",
        symbol: {
          type: "simple-marker",
          size: 3.5,
          color: [25, 118, 210, 0.65], // softer blue w/ opacity
          outline: { color: [255, 255, 255, 0.7], width: 0.5 },
        },
      };

      // City boundary layer
      const cityLimitsLayer = new FeatureLayer({
        url: "https://gisent.coralgables.com/entserver/rest/services/Crime_Map_MIL1/MapServer/1",
        outFields: ["*"],
        popupEnabled: false,
      });

      cityLimitsLayer.renderer = {
        type: "simple",
        symbol: {
          type: "simple-fill",
          color: [0, 0, 0, 0], // transparent fill
          outline: {
            color: COLORS.cityRed,
            width: 1.5,
          },
        },
      };

      view.map.addMany([addressLayer, cityLimitsLayer]);

      // Keep boundary above points
      view.map.reorder(cityLimitsLayer, view.map.layers.length - 1);

      // ============================================================
      // SKETCH (Rectangle / Polygon)
      // ============================================================
      const sketch = new Sketch({
        view,
        layer: drawLayer,
        creationMode: "single",
        availableCreateTools: ["rectangle", "polygon"],
        visibleElements: {
          createTools: { point: false, polyline: false, circle: false },
          selectionTools: false,
          settingsMenu: false,
          undoRedoMenu: true,
        },
      });

      // Make Sketch draw outline teal (instead of default black)
      sketch.viewModel.polygonSymbol = {
        type: "simple-fill",
        color: COLORS.tealFill,
        outline: { color: COLORS.teal, width: 2 },
      };

      sketch.viewModel.rectangleSymbol = {
        type: "simple-fill",
        color: COLORS.tealFill,
        outline: { color: COLORS.teal, width: 2 },
      };

      // ============================================================
      // HELPERS
      // ============================================================
      function s(v) {
        return String(v ?? "").trim();
      }

      function escapeHtml(str) {
        return String(str ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");
      }

      const GEOCODE_URL =
        "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";

      async function reverseGeocodePoint(mapPoint) {
        try {
          if (!mapPoint) return "";

          const res = await locator.locationToAddress(GEOCODE_URL, {
            location: mapPoint,
            distance: 120, // ✅ search within ~120m for nearest address
          });

          return res?.address?.Match_addr || "";
        } catch (err) {
          console.warn("Reverse geocode failed:", err);
          return "";
        }
      }

      function formatFullSiteAddressFromAttrs(a = {}) {
        const addr = getSiteAddressLine(a);
        const city = getSiteCity(a);
        const zip = zip5(getSiteZip(a));
        const parts = [];
        if (addr) parts.push(addr);
        const cityLine = [city, "FL", zip]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (cityLine) parts.push(cityLine);
        return parts.join(", ");
      }

      function nearestSelectedAddress(centerPoint, features = []) {
        if (!centerPoint || !features.length) return "";

        let best = null;
        let bestDist = Infinity;

        for (const f of features) {
          const g = f?.geometry;
          if (!g) continue;

          // distance in meters
          const d = geometryEngine.distance(centerPoint, g, "meters");
          if (typeof d === "number" && d < bestDist) {
            bestDist = d;
            best = f;
          }
        }

        if (!best) return "";
        return formatFullSiteAddressFromAttrs(best.attributes || {});
      }

      function formatNumber(n, digits = 0) {
        if (typeof n !== "number" || !isFinite(n)) return "";
        return n.toLocaleString(undefined, {
          maximumFractionDigits: digits,
          minimumFractionDigits: digits,
        });
      }

      // Returns { sqFt, acres } or null
      function computeArea(geom) {
        try {
          if (!geom) return null;

          // geometryEngine.geodesicArea returns square meters if unit is "square-meters"
          const sqm = geometryEngine.geodesicArea(geom, "square-meters");
          if (typeof sqm !== "number" || !isFinite(sqm) || sqm <= 0) return null;

          const sqFt = sqm * 10.763910416709722; // m² -> ft²
          const acres = sqFt / 43560; // ft² -> acres

          return { sqFt, acres };
        } catch {
          return null;
        }
      }

      function safeClosePopup() {
        try {
          // Different ArcGIS view implementations behave differently
          if (!view || !view.popup) return;

          // Preferred: hide it (works even if close() doesn't exist)
          view.popup.visible = false;

          // If close() exists in this environment, call it too
          if (typeof view.popup.close === "function") {
            view.popup.close();
          }
        } catch {
          // do nothing
        }
      }

      function formatDateTime(d) {
        try {
          if (!d) return "";
          const dt = d instanceof Date ? d : new Date(d);
          return dt.toLocaleString();
        } catch {
          return "";
        }
      }

      function selectionSummaryLine(meta) {
        const m = meta?.method || "";

        if (m === "radius") {
          const r = meta?.radiusValue ?? "";
          const u = meta?.radiusUnit ?? "";
          return `Radius selection: ${r} ${u}`.trim();
        }

        if (m === "draw") {
          const acres = meta?.drawAreaAcres;
          const sqFt = meta?.drawAreaSqFt;

          if (typeof acres === "number" && isFinite(acres) && acres > 0) {
            return `Drawn area: ${formatNumber(acres, 2)} acres (${formatNumber(
              sqFt,
              0
            )} sq ft)`;
          }

          return "Drawn area selection";
        }

        return "Selection";
      }

      function zip5(z) {
        const m = s(z).match(/^(\d{5})/);
        return m ? m[1] : "";
      }

      function formatUsDateTime(d) {
        if (!d) return "";
        const dt = d instanceof Date ? d : new Date(d);

        const parts = new Intl.DateTimeFormat("en-US", {
          month: "2-digit",
          day: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).formatToParts(dt);

        const get = (t) => parts.find((p) => p.type === t)?.value || "";

        return `${get("month")}/${get("day")}/${get("year")}, ${get(
          "hour"
        )}:${get("minute")}:${get("second")}`;
      }

      function normalizeText(t) {
        return s(t)
          .toUpperCase()
          .replace(/[.,]/g, " ")
          .replace(/#/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      function normalizeState(st) {
        const x = normalizeText(st);
        if (!x) return "";
        if (x === "FL" || x === "FLORIDA") return "FL";
        return x;
      }

      function openHelpCenter() {
        helpOverlay?.classList.remove("hidden");
      }

      function closeHelpCenter() {
        helpOverlay?.classList.add("hidden");
      }

      helpBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        openHelpCenter();
      });

      helpClose?.addEventListener("click", closeHelpCenter);

      helpOverlay?.addEventListener("click", (e) => {
        if (e.target === helpOverlay) closeHelpCenter();
      });

      function openWelcome() {
        welcomeOverlay?.classList.remove("hidden");
      }

      function closeWelcome() {
        welcomeOverlay?.classList.add("hidden");
      }

      // Show welcome on first visit only
      setTimeout(() => {
        const seen = localStorage.getItem("cg-mailing-tour-seen");
        if (!seen) {
          openWelcome();
        }
      }, 600);

      // Tour highlight state
      let currentHighlightedEl = null;

      function highlightTarget(selector) {
        if (currentHighlightedEl) {
          currentHighlightedEl.classList.remove("tour-spotlight");
          currentHighlightedEl = null;
        }

        const el = document.querySelector(selector);
        if (!el) return;

        el.classList.add("tour-spotlight");
        currentHighlightedEl = el;
      }

      function clearHighlight() {
        if (currentHighlightedEl) {
          currentHighlightedEl.classList.remove("tour-spotlight");
          currentHighlightedEl = null;
        }
      }

      let tourIndex = 0;

      const TOUR_STEPS = [
  {
    title: "Welcome",
    body: "This quick tour shows how to select addresses and create mailing labels. You can restart the tour anytime from Help.",
    anchor: "#help-btn",
    placement: "right",
  },
  {
    title: "Draw Selection",
    body: "Use the Draw tool to select an area with a rectangle or polygon.",
    anchor: "#draw-btn",
    placement: "left",
  },
  {
    title: "Radius Selection",
    body: "Use the Radius tool to select addresses by distance. Set the radius, click Apply, then click the map.",
    anchor: "#radius-btn",
    placement: "left",
  },
  {
    title: "Selected Addresses",
    body: "Open the address list to view selected results and export data.",
    anchor: "#floating-list-btn",
    placement: "left",
  },
  {
    title: "Draft Labels",
    body: "Create Avery 5161 labels for Owners, Residents, or both.",
    anchor: "#draft-btn",
    placement: "left",
  },
  {
    title: "Clear Selection",
    body: "Use Clear to reset and start a new selection.",
    anchor: "#btn-clear",
    placement: "right",
  },
];


      function openTour() {
        tourIndex = 0;
        closeHelpCenter();
        tourOverlay?.classList.remove("hidden");
        renderTourStep();
      }

      function closeTour() {
        tourOverlay?.classList.add("hidden");
        clearHighlight();
      }

      function renderTourStep() {
        const step = TOUR_STEPS[tourIndex];
        if (!step) return;

        if (tourTitle) tourTitle.textContent = step.title;
        if (tourBody) tourBody.textContent = step.body;
        if (tourStep)
          tourStep.textContent = `Step ${tourIndex + 1} of ${TOUR_STEPS.length}`;

        // Back button disabled on first
        if (tourBack) tourBack.disabled = tourIndex === 0;

        // Next button label on last step
        if (tourNext)
          tourNext.textContent =
            tourIndex === TOUR_STEPS.length - 1 ? "Finish" : "Next";

        positionTour(step.anchor, step.placement);
        highlightTarget(step.anchor);
      }

      function positionTour(selector, placement = "left") {
        const el = document.querySelector(selector);

        if (!el || !tourCard) {
          if (!tourCard) return;
          tourCard.style.left = "50%";
          tourCard.style.top = "50%";
          tourCard.style.transform = "translate(-50%, -50%)";
          return;
        }

        const arrow = document.getElementById("tour-arrow");
        const r = el.getBoundingClientRect();
        const cardW = tourCard.offsetWidth || 360;
        const cardH = tourCard.offsetHeight || 180;

        const pad = 14;
        let left = 0;
        let top = 0;

        // center vertically on target
        top = r.top + r.height / 2 - cardH / 2;

        if (placement === "right") left = r.right + pad;
        else left = r.left - cardW - pad;

        // clamp
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        left = Math.max(12, Math.min(left, vw - cardW - 12));
        top = Math.max(12, Math.min(top, vh - cardH - 12));

        tourCard.style.left = `${left}px`;
        tourCard.style.top = `${top}px`;
        tourCard.style.transform = "none";

        // Arrow direction
        tourCard.classList.remove("arrow-left", "arrow-right");
        tourCard.classList.add(placement === "right" ? "arrow-left" : "arrow-right");

        // Arrow vertical alignment to target center
        if (arrow) {
          const arrowTop = r.top + r.height / 2 - top - 8;
          arrow.style.top = `${Math.max(18, Math.min(arrowTop, cardH - 18))}px`;
        }
      }

      startTourBtn?.addEventListener("click", openTour);
      tourExit?.addEventListener("click", closeTour);

      tourOverlay?.addEventListener("click", (e) => {
        if (e.target === tourOverlay) closeTour();
      });

      tourBack?.addEventListener("click", () => {
        if (tourIndex > 0) {
          tourIndex -= 1;
          renderTourStep();
        }
      });

      tourNext?.addEventListener("click", () => {
        if (tourIndex < TOUR_STEPS.length - 1) {
          tourIndex += 1;
          renderTourStep();
        } else {
          closeTour();
        }
      });

      // Reposition on resize (keeps tour aligned)
      window.addEventListener("resize", () => {
        if (tourOverlay && !tourOverlay.classList.contains("hidden")) {
          const step = TOUR_STEPS[tourIndex];
          positionTour(step.anchor, step.placement);
        }
      });

      function openUserGuide() {
        guideOverlay?.classList.remove("hidden");
      }

      function closeUserGuide() {
        guideOverlay?.classList.add("hidden");
      }

      openGuideBtn?.addEventListener("click", () => {
        closeHelpCenter();
        openUserGuide();
      });

      guideClose?.addEventListener("click", closeUserGuide);

      guideOverlay?.addEventListener("click", (e) => {
        if (e.target === guideOverlay) closeUserGuide();
      });

      function normalizeStreet(t) {
        let x = normalizeText(t);

        const rep = [
          ["STREET", "ST"],
          ["AVENUE", "AVE"],
          ["ROAD", "RD"],
          ["DRIVE", "DR"],
          ["BOULEVARD", "BLVD"],
          ["LANE", "LN"],
          ["COURT", "CT"],
          ["CIRCLE", "CIR"],
          ["TERRACE", "TER"],
          ["PLACE", "PL"],
          ["PARKWAY", "PKWY"],
          ["HIGHWAY", "HWY"],
          ["SUITE", "STE"],
          ["APARTMENT", "APT"],
          ["UNIT", "UNIT"],
        ];

        for (const [from, to] of rep) {
          x = x.replace(new RegExp(`\\b${from}\\b`, "g"), to);
        }

        x = x
          .replace(/\b(APT|STE|UNIT)\b\s*\w+/g, "")
          .replace(/\s+/g, " ")
          .trim();

        return x;
      }

      function setListButtonEnabled(enabled) {
        if (!floatingBtn) return;
        floatingBtn.classList.toggle("is-disabled", !enabled);
      }

      // ============================================================
      // TOAST / MODAL HELPERS
      // ============================================================
      function showToast(count) {
        if (toastTitleEl) toastTitleEl.textContent = "📍 Selection Updated";
        if (toastSubEl) {
          toastSubEl.textContent = `${count} address${
            count === 1 ? "" : "es"
          } selected`;
        }

        toastEl?.classList.remove("hidden");
        setListButtonEnabled(count > 0);

        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl?.classList.add("hidden"), 3500);
      }

      function closeModal() {
        modalOverlay?.classList.add("hidden");
      }

      function clearSelection() {
        selectedFeatures = [];
        allRows = [];
        filteredRows = [];

        drawLayer.removeAll();
        selectionLayer.removeAll();

        toastEl?.classList.add("hidden");
        closeModal();
        setListButtonEnabled(false);

        if (modalCount) modalCount.textContent = "0";
        if (modalTbody) modalTbody.innerHTML = "";

        selectionMeta = {
          method: "",
          radiusValue: null,
          radiusUnit: "",
          centerPoint: null,
          centerAddress: "",
          selectedCount: 0,
          labelType: "",
          createdAt: null,
          drawAreaSqFt: null,
          drawAreaAcres: null,
        };

        window.selectionMeta = selectionMeta;
      }

      // ============================================================
      // FIELD GETTERS
      // ============================================================
      function getSiteAddressLine(a) {
        const direct = s(a.TRUE_SITE_ADDR_NO_UNIT) || s(a.TRUE_SITE_ADDR);
        if (direct) return direct;

        const parts = [
          s(a.STREETNUMBER),
          s(a.STREETPREDIR),
          s(a.STREETNAME),
          s(a.STREETTYPE),
        ].filter(Boolean);

        return parts.join(" ");
      }

      function getSiteCity(a) {
        return s(a.TRUE_SITE_CITY) || "Coral Gables";
      }

      function getSiteZip(a) {
        return s(a.TRUE_SITE_ZIP_CODE);
      }

      function getOwnerLines(a) {
        const owner1 = s(a.TRUE_OWNER1);
        return [owner1 || "RESIDENT"];
      }

      // ============================================================
      // DRAFT LABELS HELPERS
      // ============================================================
      function getMailingAddressLines(a) {
        const addr = [
          s(a.TRUE_MAILING_ADDR1),
          s(a.TRUE_MAILING_ADDR2),
          s(a.TRUE_MAILING_ADDR3),
        ]
          .filter(Boolean)
          .join(" ");

        const city = s(a.TRUE_MAILING_CITY);
        const state = normalizeState(a.TRUE_MAILING_STATE);
        const zip = s(a.TRUE_MAILING_ZIP_CODE);
        const country = s(a.TRUE_MAILING_COUNTRY);

        const lines = [];
        if (addr) lines.push(addr);

        const cityStateZip =
          city && state && zip
            ? `${city}, ${state} ${zip}`
            : city && state
            ? `${city}, ${state}`
            : city && zip
            ? `${city} ${zip}`
            : [city, state, zip].filter(Boolean).join(" ");

        if (cityStateZip) lines.push(cityStateZip);

        const c = normalizeText(country);
        if (country && c && c !== "USA" && c !== "UNITED STATES") lines.push(country);

        return lines;
      }

      function ownerIsResident(a) {
        const siteAddr = normalizeStreet(getSiteAddressLine(a));
        const siteCity = normalizeText(getSiteCity(a));
        const siteZip = zip5(getSiteZip(a));

        const mailAddrRaw = [
          s(a.TRUE_MAILING_ADDR1),
          s(a.TRUE_MAILING_ADDR2),
          s(a.TRUE_MAILING_ADDR3),
        ]
          .filter(Boolean)
          .join(" ");
        const mailAddr = normalizeStreet(mailAddrRaw);

        const mailCity = normalizeText(a.TRUE_MAILING_CITY);
        const mailState = normalizeState(a.TRUE_MAILING_STATE);
        const mailZip = zip5(a.TRUE_MAILING_ZIP_CODE);

        if (!siteAddr || !mailAddr) return false;

        const addrMatch = mailAddr.includes(siteAddr) || siteAddr.includes(mailAddr);
        if (!addrMatch) return false;

        if (mailState && mailState !== "FL") return false;
        if (mailCity && siteCity && mailCity !== siteCity) return false;
        if (mailZip && siteZip && mailZip !== siteZip) return false;

        return true;
      }

      function buildLabelsFromSelectedFeatures(features, mode) {
        const labels = [];

        features.forEach((f) => {
          const a = f.attributes || {};

          const siteAddr = getSiteAddressLine(a);
          const siteCity = getSiteCity(a);
          const siteZip = zip5(getSiteZip(a));

          const ownerName = getOwnerLines(a)[0] || "RESIDENT";
          const ownerLabel = [ownerName, ...getMailingAddressLines(a)].filter(Boolean);
          const residentLabel = ["RESIDENT", siteAddr, `${siteCity}, FL ${siteZip}`.trim()].filter(Boolean);

          if (mode === "owners") return labels.push(ownerLabel);
          if (mode === "residents") return labels.push(residentLabel);

          const isRes = ownerIsResident(a);
          if (isRes) labels.push([ownerName, siteAddr, `${siteCity}, FL ${siteZip}`.trim()].filter(Boolean));
          else labels.push(ownerLabel, residentLabel);
        });

        return labels;
      }

      function waitForViewStable(view) {
        return new Promise((resolve) => {
          if (!view) return resolve();

          // if already stable, resolve immediately
          if (!view.updating) return resolve();

          const h = view.watch("updating", (updating) => {
            if (!updating) {
              h.remove();
              resolve();
            }
          });
        });
      }

      async function openPrintWindowFor5161(labels) {
        const PER_PAGE = 20; // Avery 5161 = 2 cols x 10 rows
        const all = Array.isArray(labels) ? labels : [];

        const PRINT_SCALE_MIN = 6000; // closer than this looks too "tight" / not professional
        const PRINT_SCALE_MAX = 16000; // farther than this loses street labels

        // ---- Cover page data ----
        const meta = window.selectionMeta || selectionMeta || {};
        const methodLine = selectionSummaryLine(meta);
        const createdLine = selectionMeta.createdAt
          ? formatUsDateTime(selectionMeta.createdAt)
          : "";
        const countLine = `${meta.selectedCount || 0} address${
          (meta.selectedCount || 0) === 1 ? "" : "es"
        }`;

        const labelLine = (() => {
          const t = String(meta.labelType || "").toLowerCase();
          if (t === "owners") return "Owners";
          if (t === "residents") return "Residents";
          if (t === "both") return "Residents and Owners";
          return "";
        })();

        // Try to screenshot the map (optional; won’t crash printing if it fails)
        let screenshotDataUrl = "";

        try {
          if (view && typeof view.takeScreenshot === "function") {
            const prevViewpoint = view.viewpoint?.clone?.();
            const prevPadding = { ...view.padding };

            // 1) Remove app padding so screenshot is "clean"
            view.padding = { top: 0, left: 0, right: 0, bottom: 0 };

            // 2) Frame selection + clamp to a professional print scale
            if (lastSelectionGeometry) {
              // clamp desired scale based on whatever goTo would pick
              await view.goTo(lastSelectionGeometry, {
                animate: false,
                padding: { top: 90, left: 90, right: 90, bottom: 90 },
              });

              const clampedScale = Math.min(
                PRINT_SCALE_MAX,
                Math.max(PRINT_SCALE_MIN, view.scale)
              );

              // ✅ one clean goTo using target + clamped scale
              await view.goTo(
                { target: lastSelectionGeometry, scale: clampedScale },
                {
                  animate: false,
                  padding: { top: 90, left: 90, right: 90, bottom: 90 },
                }
              );
            }

            await view.when();
            await waitForViewStable(view); // ✅ wait until the view stops updating
            await new Promise((r) => setTimeout(r, 120)); // small buffer for tiles/labels

            // 4) Force a consistent screenshot size (important!)
            const shot = await view.takeScreenshot({
              format: "png",
              quality: 0.95,
              width: 1400,
              height: 900,
            });

            screenshotDataUrl = shot?.dataUrl || "";

            // Restore original view + padding
            view.padding = prevPadding;
            if (prevViewpoint) {
              await view.goTo(prevViewpoint, { animate: false });
            }
          }
        } catch {
          screenshotDataUrl = "";
        }

        // ---- Split labels into pages of 20 ----
        const pages = [];
        for (let i = 0; i < all.length; i += PER_PAGE) {
          pages.push(all.slice(i, i + PER_PAGE));
        }
        if (pages.length === 0) pages.push([]);

        const renderCoverPage = () => {
          const centerAddr =
            (meta.centerAddress || "").trim() || "Selected area (address unavailable)";

          return `
            <div class="cover-page">
              <div class="cover-header">
                <div class="cover-title">Mailing Labels — Print Summary</div>
                <div class="cover-sub">City of Coral Gables: Mailing Labels App</div>
              </div>

              <div class="cover-card">
                <div class="row"><div class="k">Selection</div><div class="v">${escapeHtml(methodLine)}</div></div>
                <div class="row"><div class="k">Center address</div><div class="v">${escapeHtml(centerAddr)}</div></div>
                <div class="row"><div class="k">Selected</div><div class="v">${escapeHtml(countLine)}</div></div>
                <div class="row"><div class="k">Label type</div><div class="v">${escapeHtml(labelLine || "—")}</div></div>
                <div class="row"><div class="k">Created</div><div class="v">${escapeHtml(createdLine || "—")}</div></div>
              </div>

              ${
                screenshotDataUrl
                  ? `<div class="map-shot-wrap">
                      <div class="map-shot-title">Selected area (map snapshot)</div>
                      <img class="map-shot" src="${screenshotDataUrl}" alt="Map screenshot" />
                    </div>`
                  : `<div class="map-shot-wrap">
                      <div class="map-shot-title">Selected area (map snapshot)</div>
                      <div class="map-shot-missing">Screenshot unavailable</div>
                    </div>`
              }
            </div>
          `;
        };

        const renderLabelPage = (pageLabels) => {
          const padded = pageLabels.slice(0, PER_PAGE);
          while (padded.length < PER_PAGE) padded.push([""]); // fill to full sheet

          return `
            <div class="page">
              <div class="grid">
                ${padded
                  .map((lines) => {
                    const content = (lines || [])
                      .map(
                        (ln, i) =>
                          `<div class="${i === 0 ? "line1" : ""}">${escapeHtml(
                            ln
                          )}</div>`
                      )
                      .join("");
                    return `<div class="label">${content}</div>`;
                  })
                  .join("")}
              </div>
            </div>
          `;
        };

        const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Avery 5161 Labels</title>
  <style>
    @page { size: letter; margin: 0; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; }

    /* ---------- Cover page ---------- */
    :root { color-scheme: light; }
    html, body { background: #ffffff !important; }

    .cover-page{
      box-sizing: border-box;
      width: 8.5in;
      height: 11in;
      padding: 0.55in 0.6in;
      page-break-after: always;
    }

    .cover-header{
      padding: 14px 16px;
      border-radius: 14px;
      background: #0b6f73;
      color: white;
    }

    .cover-title{ font-size: 20px; font-weight: 800; }
    .cover-sub{ margin-top: 6px; opacity: 0.95; }

    .cover-card{
      margin-top: 14px;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 14px;
      padding: 12px 14px;
      background: #fff;
    }

    .row{
      display: flex;
      gap: 14px;
      padding: 8px 0;
      border-bottom: 1px solid rgba(0,0,0,0.06);
    }

    .row:last-child{ border-bottom: 0; }
    .k{ width: 140px; font-weight: 800; color: rgba(0,0,0,0.6); }
    .v{ flex: 1; font-weight: 700; color: rgba(0,0,0,0.85); }

    .map-shot-wrap{
      margin-top: 14px;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 14px;
      padding: 12px 14px;
      background: #fff;
    }

    .map-shot-title{
      font-weight: 900;
      margin-bottom: 10px;
      color: rgba(0,0,0,0.85);
      font-size: 14px;
    }

    .map-shot{
      width: 100%;
      height: 5.8in;
      object-fit: contain;
      background: #fff;
      border-radius: 12px;
      border: 1px solid rgba(0,0,0,0.08);
    }

    .map-shot-missing{
      padding: 18px;
      border-radius: 12px;
      background: rgba(0,0,0,0.04);
      color: rgba(0,0,0,0.6);
      font-weight: 700;
    }

    /* ---------- Avery 5161 pages ---------- */
    .page {
      box-sizing: border-box;
      width: 8.5in;
      height: 11in;
      padding-top: 0.5in;
      padding-bottom: 0.5in;
      padding-left: 0.15625in;
      padding-right: 0.15625in;
      page-break-after: always;
    }

    .page:last-child { page-break-after: auto; }

    .grid {
      display: grid;
      grid-template-columns: 4in 4in;
      column-gap: 0.1875in;
      grid-template-rows: repeat(10, 1in);
      row-gap: 0;
    }

    .label {
      width: 4in;
      height: 1in;
      box-sizing: border-box;
      padding: 0.12in 0.18in;
      overflow: hidden;
      font-size: 10pt;
      line-height: 1.1;
    }

    .line1 { font-weight: 700; }
  </style>
</head>
<body>
  ${renderCoverPage()}
  ${pages.map(renderLabelPage).join("")}
  <script>window.onload = () => window.print();</script>
</body>
</html>
        `.trim();

        const w = window.open("", "_blank");
        w.document.open();
        w.document.write(html);
        w.document.close();
      }

      // ============================================================
      // MODAL TABLE
      // ============================================================
      function normalizeRowForTable(a = {}) {
        const owners = getOwnerLines(a);
        return {
          owner: owners[0] || "RESIDENT",
          address: getSiteAddressLine(a),
          city: getSiteCity(a),
          state: "FL",
          zip: getSiteZip(a),
          folio: s(a.FOLIO),
        };
      }

      function renderRowsToTable(rows) {
        if (!modalTbody) return;
        modalTbody.innerHTML = "";

        rows.forEach((r) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${escapeHtml(r.owner)}</td>
            <td>${escapeHtml(r.address)}</td>
            <td>${escapeHtml(r.city)}</td>
            <td>${escapeHtml(r.state)}</td>
            <td>${escapeHtml(r.zip)}</td>
            <td>${escapeHtml(r.folio)}</td>
          `;
          modalTbody.appendChild(tr);
        });
      }

      function extractHouseNumber(addr) {
        const m = String(addr || "").trim().match(/^(\d+)/);
        return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
      }

      function extractZipNum(zip) {
        const m = String(zip || "").match(/^\d+/);
        return m ? parseInt(m[0], 10) : Number.POSITIVE_INFINITY;
      }

      function debounce(fn, ms = 150) {
        let t;
        return (...args) => {
          clearTimeout(t);
          t = setTimeout(() => fn(...args), ms);
        };
      }

      function applyAddressFilters() {
        const ownerEl = document.getElementById("filterOwner");
        const addrEl = document.getElementById("filterAddress");
        const sortAddrEl = document.getElementById("sortAddressNum");
        const sortZipEl = document.getElementById("sortZip");
        if (!ownerEl || !addrEl || !sortAddrEl || !sortZipEl) return;

        const ownerQ = ownerEl.value.trim().toLowerCase();
        const addrQ = addrEl.value.trim().toLowerCase();
        const sortAddr = sortAddrEl.value;
        const sortZip = sortZipEl.value;

        filteredRows = allRows.filter((r) => {
          if (ownerQ && !String(r.owner || "").toLowerCase().includes(ownerQ)) return false;
          if (addrQ && !String(r.address || "").toLowerCase().includes(addrQ)) return false;
          return true;
        });

        const dir = (x) => (String(x).endsWith("_desc") ? -1 : 1);

        if (sortAddr) {
          const d = dir(sortAddr);
          filteredRows.sort(
            (a, b) => (extractHouseNumber(a.address) - extractHouseNumber(b.address)) * d
          );
        } else if (sortZip) {
          const d = dir(sortZip);
          filteredRows.sort((a, b) => (extractZipNum(a.zip) - extractZipNum(b.zip)) * d);
        }

        if (modalCount) modalCount.textContent = String(filteredRows.length);
        renderRowsToTable(filteredRows);
      }

      function wireFilterEventsOnce() {
        const ownerEl = document.getElementById("filterOwner");
        const addrEl = document.getElementById("filterAddress");
        const sortAddrEl = document.getElementById("sortAddressNum");
        const sortZipEl = document.getElementById("sortZip");
        const clearEl = document.getElementById("clearFiltersBtn");
        if (!ownerEl || !addrEl || !sortAddrEl || !sortZipEl || !clearEl) return;

        if (ownerEl.dataset.wired === "1") return;
        ownerEl.dataset.wired = "1";

        const onType = debounce(applyAddressFilters, 150);
        ownerEl.addEventListener("input", onType);
        addrEl.addEventListener("input", onType);

        sortAddrEl.addEventListener("change", () => {
          if (sortAddrEl.value) sortZipEl.value = "";
          applyAddressFilters();
        });

        sortZipEl.addEventListener("change", () => {
          if (sortZipEl.value) sortAddrEl.value = "";
          applyAddressFilters();
        });

        clearEl.addEventListener("click", () => {
          ownerEl.value = "";
          addrEl.value = "";
          sortAddrEl.value = "";
          sortZipEl.value = "";
          applyAddressFilters();
        });
      }

      function openModal() {
        modalOverlay?.classList.remove("hidden");

        if (!selectedFeatures.length) {
          emptyStateEl?.classList.remove("hidden");
          if (modalCount) modalCount.textContent = "0";
          if (modalTbody) modalTbody.innerHTML = "";
          return;
        }

        emptyStateEl?.classList.add("hidden");

        allRows = selectedFeatures.map((f, i) => {
          const r = normalizeRowForTable(f.attributes || {});
          r.__i = i;
          return r;
        });

        wireFilterEventsOnce();

        const ownerEl = document.getElementById("filterOwner");
        const addrEl = document.getElementById("filterAddress");
        const sortAddrEl = document.getElementById("sortAddressNum");
        const sortZipEl = document.getElementById("sortZip");

        if (ownerEl) ownerEl.value = "";
        if (addrEl) addrEl.value = "";
        if (sortAddrEl) sortAddrEl.value = "";
        if (sortZipEl) sortZipEl.value = "";

        filteredRows = [];
        applyAddressFilters();
      }

      // ============================================================
      // EXPORT
      // ============================================================
      function getExportRows() {
        const rows = filteredRows?.length ? filteredRows : allRows;
        return rows.map((r) => selectedFeatures[r.__i]?.attributes).filter(Boolean);
      }

      function downloadBlob(filename, blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }

      function exportCSV() {
        const data = getExportRows();
        if (!data.length) return;

        const headers = Object.keys(data[0]);
        const lines = [
          headers.join(","),
          ...data.map((row) =>
            headers
              .map((h) => {
                const v = row[h] ?? "";
                const s2 = String(v).replaceAll('"', '""');
                return `"${s2}"`;
              })
              .join(",")
          ),
        ];

        downloadBlob(
          "selected_addresses.csv",
          new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" })
        );
      }

      function exportXLSX() {
        const data = getExportRows();
        if (!data.length) return;

        const XLSX_LIB = window.XLSX || (typeof XLSX !== "undefined" ? XLSX : null);
        if (!XLSX_LIB) {
          alert(
            "Excel library not loaded. Make sure xlsx.full.min.js is included BEFORE script.js."
          );
          return;
        }

        const ws = XLSX_LIB.utils.json_to_sheet(data);
        const wb = XLSX_LIB.utils.book_new();
        XLSX_LIB.utils.book_append_sheet(wb, ws, "Selected Addresses");

        const arrayBuffer = XLSX_LIB.write(wb, { bookType: "xlsx", type: "array" });
        downloadBlob(
          "selected_addresses.xlsx",
          new Blob([arrayBuffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          })
        );
      }

      // ============================================================
      // MENUS (Draw / Radius / Download)
      // ============================================================
      function closeDrawMenu() {
        drawMenu?.classList.add("hidden");
      }

      function toggleDrawMenu() {
        drawMenu?.classList.toggle("hidden");
      }

      function openRadiusMenu() {
        if (!radiusMenu) return;

        if (radiusInput && radiusMenuValue) radiusMenuValue.value = radiusInput.value || "1000";
        if (radiusUnitSelect && radiusMenuUnit)
          radiusMenuUnit.value = radiusUnitSelect.value || "feet";

        radiusMenu.classList.remove("hidden");
      }

      function closeRadiusMenu() {
        radiusMenu?.classList.add("hidden");
      }

      function toggleRadiusMenu() {
        if (!radiusMenu) return;
        radiusMenu.classList.contains("hidden") ? openRadiusMenu() : closeRadiusMenu();
      }

      function closeDownloadMenu() {
        downloadMenu?.classList.add("hidden");
      }

      function toggleDownloadMenu() {
        downloadMenu?.classList.toggle("hidden");
      }

      document.addEventListener("click", () => {
        closeDrawMenu();
        closeRadiusMenu();
        closeDownloadMenu();
      });

      drawMenu?.addEventListener("click", (e) => e.stopPropagation());
      radiusMenu?.addEventListener("click", (e) => e.stopPropagation());
      downloadMenu?.addEventListener("click", (e) => e.stopPropagation());

      drawBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        closeRadiusMenu();
        closeDownloadMenu();
        toggleDrawMenu();
      });

      toolArrow?.addEventListener("click", () => {
        sketch.cancel();
        closeDrawMenu();
      });

      toolRect?.addEventListener("click", () => {
        sketch.create("rectangle");
        closeDrawMenu();
      });

      toolPoly?.addEventListener("click", () => {
        sketch.create("polygon");
        closeDrawMenu();
      });

      radiusBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        closeDrawMenu();
        closeDownloadMenu();
        toggleRadiusMenu();
      });

      radiusMenuApply?.addEventListener("click", () => {
        if (radiusInput && radiusMenuValue) radiusInput.value = radiusMenuValue.value || "1000";
        if (radiusUnitSelect && radiusMenuUnit)
          radiusUnitSelect.value = radiusMenuUnit.value || "feet";

        clickMode = "radius";
        closeRadiusMenu();
      });

      downloadBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        closeDrawMenu();
        closeRadiusMenu();
        toggleDownloadMenu();
      });

      downloadCsvBtn?.addEventListener("click", () => {
        closeDownloadMenu();
        exportCSV();
      });

      downloadXlsxBtn?.addEventListener("click", () => {
        closeDownloadMenu();
        exportXLSX();
      });

      // ============================================================
      // DRAFT LABELS MODAL
      // ============================================================
      function openDraftModal() {
        if (draftError) {
          draftError.textContent = "";
          draftError.style.display = "none";
        }
        draftOverlay?.classList.remove("hidden");
      }

      function closeDraftModal() {
        draftOverlay?.classList.add("hidden");
      }

      draftFloatingBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        openDraftModal();
      });

      draftClose?.addEventListener("click", closeDraftModal);

      draftOverlay?.addEventListener("click", (e) => {
        if (e.target === draftOverlay) closeDraftModal();
      });

      draftCreate?.addEventListener("click", () => {
        if (draftError) {
          draftError.textContent = "";
          draftError.style.display = "none";
        }

        if (!selectedFeatures.length) {
          if (draftError) {
            draftError.textContent =
              "Please select an area first (radius or draw selection).";
            draftError.style.display = "block";
          }
          return;
        }

        const mode =
          document.querySelector('input[name="draftMode"]:checked')?.value || "both";
        selectionMeta.labelType = mode;

        const labels = buildLabelsFromSelectedFeatures(selectedFeatures, mode);

        if (!labels.length) {
          if (draftError) {
            draftError.textContent =
              "No labels could be generated from the current selection.";
            draftError.style.display = "block";
          }
          return;
        }

        closeDraftModal();
        openPrintWindowFor5161(labels);
      });

      // ============================================================
      // SKETCH EVENTS (selection)
      // ============================================================
      sketch.on("create", async (e) => {
        if (e.state === "start") {
          closeDrawMenu();
          closeRadiusMenu();
          closeDownloadMenu();

          drawLayer.removeAll();
          selectionLayer.removeAll();
          safeClosePopup();
        }

        if (e.state === "complete") {
          closeDrawMenu();
          closeRadiusMenu();
          closeDownloadMenu();

          // ✅ Keep the drawn boundary (don’t clear drawLayer here)
          selectionLayer.removeAll();

          const geom = e.graphic.geometry;

          // ✅ Compute drawn area
          const area = computeArea(geom);
          selectionMeta.drawAreaSqFt = area?.sqFt ?? null;
          selectionMeta.drawAreaAcres = area?.acres ?? null;

          selectionMeta.method = "draw";
          selectionMeta.radiusValue = null;
          selectionMeta.radiusUnit = "";

          // ✅ Better center point (centroid first, fallback to extent center)
          let center = null;
          try {
            center = (geometryEngine.labelPoint && geometryEngine.labelPoint(geom)) || null;
          } catch {
            center = null;
          }

          selectionMeta.centerPoint = center || geom?.extent?.center || null;
          selectionMeta.createdAt = new Date();

          // ✅ Save geometry for screenshot zooming
          lastSelectionGeometry = geom;

          // Try reverse geocode
          selectionMeta.centerAddress = await reverseGeocodePoint(selectionMeta.centerPoint);

          // Select addresses first (so we can fallback to nearest selected address)
          await selectPointsInside(geom);

          // ✅ Fallback if reverse geocode returned nothing
          if (!selectionMeta.centerAddress && selectedFeatures.length) {
            selectionMeta.centerAddress =
              nearestSelectedAddress(selectionMeta.centerPoint, selectedFeatures) ||
              "Selected area (address unavailable)";
          }

          console.log("Center address:", selectionMeta.centerAddress);
          window.selectionMeta = selectionMeta;
        }
      });

      // ============================================================
      // HOOK UI EVENTS
      // ============================================================
      document.getElementById("btn-clear").onclick = () => {
        clearSelection();
        clickMode = "identify";
      };

      if (floatingBtn) {
        floatingBtn.onclick = (e) => {
          e.stopPropagation();
          openModal();
        };
      }

      modalClose?.addEventListener("click", closeModal);
      modalOverlay?.addEventListener("click", (e) => {
        if (e.target === modalOverlay) closeModal();
      });

      welcomeStart?.addEventListener("click", () => {
        localStorage.setItem("cg-mailing-tour-seen", "1");
        closeWelcome();
        openTour();
      });

      welcomeSkip?.addEventListener("click", () => {
        localStorage.setItem("cg-mailing-tour-seen", "1");
        closeWelcome();
      });

      // ============================================================
      // POPUP (Identify)
      // ============================================================
      function openMailPopup(geometry, a = {}) {
        const siteAddr = getSiteAddressLine(a);
        const ownerMain = getOwnerLines(a)[0] || "RESIDENT";
        const zip = zip5(getSiteZip(a));

        view.popup.open({
          title: "",
          location: geometry,
          content: `
            <div style="border-radius:12px; overflow:hidden; background:#FAF7F2; box-shadow:0 8px 20px rgba(0,0,0,0.15);">
              <div style="background:#DCC7A1; color:#4E342E; font-weight:800; padding:10px 12px; font-size:15px; border-bottom:1px solid rgba(78,52,46,0.25);">
                ${escapeHtml(siteAddr || "Unknown address")}
              </div>
              <div style="padding:12px; font-size:14px; line-height:1.55; color:#1f1f1f;">
                <div style="margin-bottom:6px;"><b>Owner:</b> ${escapeHtml(ownerMain)}</div>
                <div style="margin-bottom:6px;"><b>City:</b> ${escapeHtml(getSiteCity(a))}</div>
                <div style="margin-bottom:6px;"><b>State:</b> FL</div>
                <div style="margin-bottom:6px;"><b>ZIP:</b> ${escapeHtml(zip)}</div>
                <div style="margin-bottom:6px;"><b>FOLIO:</b> ${escapeHtml(s(a.FOLIO))}</div>
              </div>
            </div>
          `,
        });
      }

      // ============================================================
      // SELECTION QUERY + RENDER SELECTED SYMBOL
      // ============================================================
      async function selectPointsInside(geometry) {
        const q = addressLayer.createQuery();
        q.geometry = geometry;
        q.spatialRelationship = "intersects";
        q.returnGeometry = true;
        q.outFields = ["*"];

        const res = await addressLayer.queryFeatures(q);
        selectedFeatures = res.features;

        selectionMeta.selectedCount = selectedFeatures.length;
        showToast(selectedFeatures.length);

        selectionLayer.removeAll();

        res.features.forEach((f) => {
          // Outer white ring (thin, slightly smaller)
          selectionLayer.add(
            new Graphic({
              geometry: f.geometry,
              symbol: {
                type: "simple-marker",
                size: 8,
                color: [0, 0, 0, 0],
                outline: { color: COLORS.selectedRingWhite, width: 1.25 },
              },
            })
          );

          // Red ring (thin, muted)
          selectionLayer.add(
            new Graphic({
              geometry: f.geometry,
              symbol: {
                type: "simple-marker",
                size: 7,
                color: [0, 0, 0, 0],
                outline: { color: COLORS.selectedRingRed, width: 1.25 },
              },
            })
          );

          // Blue center (slightly smaller)
          selectionLayer.add(
            new Graphic({
              geometry: f.geometry,
              symbol: {
                type: "simple-marker",
                size: 5,
                color: COLORS.selectedFill,
                outline: { color: [255, 255, 255, 0], width: 0 },
              },
            })
          );
        });
      }

      // ============================================================
      // MAP CLICK
      // ============================================================
      view.on("click", async (event) => {
        if (sketch.state === "active") return;

        // Identify mode
        if (clickMode === "identify") {
          const hit = await view.hitTest(event);
          const result = hit.results.find((r) => r.graphic?.layer === addressLayer);
          if (!result) return;
          openMailPopup(result.graphic.geometry, result.graphic.attributes || {});
          return;
        }

        // Radius mode
        if (clickMode === "radius") {
          safeClosePopup();

          selectionMeta.method = "radius";
          selectionMeta.radiusValue = Number(radiusInput?.value) || 1000;
          selectionMeta.radiusUnit = radiusUnitSelect?.value || "feet";
          selectionMeta.centerPoint = event.mapPoint;
          selectionMeta.createdAt = new Date();

          // Reverse geocode clicked point
          selectionMeta.centerAddress = await reverseGeocodePoint(selectionMeta.centerPoint);

          drawLayer.removeAll();
          selectionLayer.removeAll();

          const r = selectionMeta.radiusValue;
          const unit = selectionMeta.radiusUnit;

          const circle = geometryEngine.buffer(event.mapPoint, r, unit);
          lastSelectionGeometry = circle;

          drawLayer.add(
            new Graphic({
              geometry: circle,
              symbol: {
                type: "simple-fill",
                color: COLORS.tealFill,
                outline: { color: COLORS.teal, width: 2 },
              },
            })
          );

          await selectPointsInside(circle);

          // ✅ Fallback if reverse geocode returned nothing
          if (!selectionMeta.centerAddress && selectedFeatures.length) {
            selectionMeta.centerAddress =
              nearestSelectedAddress(selectionMeta.centerPoint, selectedFeatures) ||
              "Selected area (address unavailable)";
          }

          console.log("Center address:", selectionMeta.centerAddress);
          window.selectionMeta = selectionMeta;
        }
      });
    }
  );
});
