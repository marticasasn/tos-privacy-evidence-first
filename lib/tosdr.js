// lib/tosdr.js
const TOSDR_API = "https://api.tosdr.org";
const CACHE_PREFIX = "tosdr:";
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24h

const COMMON_SUBDOMAINS = new Set([
  "www", "m", "mobile",
  "accounts", "account", "login", "auth", "sso",
  "help", "support", "docs",
  "blog", "status",
  "api", "dev", "staging", "sandbox",
  "app", "apps", "cdn", "static", "images", "img",
]);

const CC_SLD = new Set([
  "co", "com", "net", "org", "gov", "edu", "ac", "nic", "or", "ne", "go",
]);

const COMMON_CCTLD = new Set([
  "uk","au","nz","jp","kr","cn","hk","tw","sg","in","id","my","ph","th","vn",
  "br","ar","cl","co","mx","pe","uy","ve",
  "za","ng","ke","gh","tz",
  "ca",
  "ie",
  "fr","de","es","it","nl","be","ch","at","se","no","dk","fi","pl","pt","gr","cz","hu","ro","bg","sk","si","hr","lt","lv","ee",
  "ru","ua","by","kz",
  "tr","il","sa","ae","ir",
]);

const CCTLD_TWO_PART = new Set(["co.uk", "com.au", "co.jp"]);

function isIPv4(host) {
  const m = host.match(/^(\d{1,3}\.){3}\d{1,3}$/);
  if (!m) return false;
  return host.split(".").every(n => {
    const x = Number(n);
    return x >= 0 && x <= 255;
  });
}

function isIPv6(host) {
  return host.includes(":") && /^[0-9a-fA-F:.]+$/.test(host);
}

function safeParseHostname(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;

  try {
    if (s.includes("://")) return new URL(s).hostname;
  } catch {
    // si parece URL pero falla, seguimos como hostname bruto
  }

  // si viene como "example.com/path"
  return s.split("/")[0];
}

function stripPort(hostname) {
  return hostname.split(":")[0];
}

function normalizeLabels(host) {
  let h = host.toLowerCase().trim();
  h = h.replace(/\.+$/, ""); // trailing dot
  h = stripPort(h);
  return h;
}

function registrableDomainFromLabels(labels) {
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];

  if (COMMON_CCTLD.has(tld) && CC_SLD.has(sld) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}


export function normalizeDomain(urlOrHostname) {
  const rawHost = safeParseHostname(urlOrHostname);
  if (!rawHost) return null;

  const host = normalizeLabels(rawHost);

  if (host === "localhost" || host.endsWith(".local")) return host;
  if (isIPv4(host) || isIPv6(host)) return host;

  if (!host.includes(".")) return host;

  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return host;

  const candidates = [];

  candidates.push(registrableDomainFromLabels(parts));

  let trimmed = [...parts];
  while (trimmed.length > 2 && COMMON_SUBDOMAINS.has(trimmed[0])) {
    trimmed.shift();
    candidates.push(registrableDomainFromLabels(trimmed));
  }

  const best = candidates
    .filter(d => d.includes("."))
    .sort((a, b) => b.split(".").length - a.split(".").length)[0];

  return best ?? registrableDomainFromLabels(parts);
}


async function getKey(domain) {
  return CACHE_PREFIX + domain;
}

export async function getCached(domain) {
  const key = await getKey(domain);
  const result = await chrome.storage.local.get(key);
  const entry = result[key];

  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    await chrome.storage.local.remove(key);
    return null;
  }

  // Reinyectar domain para la UI
  return { domain, ...entry.data };
}


export async function setCached(domain, data, ttl = DEFAULT_TTL) {
  const key = await getKey(domain);

  // Guardar sin domain (redundante y mejor para privacidad)
  const { domain: _domain, ...dataWithoutDomain } = data || {};

  const entry = { data: dataWithoutDomain, expiresAt: Date.now() + ttl };
  await chrome.storage.local.set({ [key]: entry });
}


function baseSummary(domain) {
  const now = Date.now();
  return {
    domain,
    serviceId: undefined,
    serviceName: undefined,
    grade: undefined,
    rating: undefined,
    points: [],
    language: "en",
    status: "no_coverage",
    fetchedAt: now,
    expiresAt: now + DEFAULT_TTL,
  };
}

// V5 search devuelve lista de servicios; elegimos el mejor match por URLs
function pickBestService(services, domain) {
  if (!Array.isArray(services) || services.length === 0) return null;

  // preferir el que tenga url que matchee el dominio exacto o termine en ".domain"
  const exact = services.find(s =>
    Array.isArray(s.urls) && s.urls.some(u => u === domain || u.endsWith("." + domain) || u.includes(domain))
  );
  return exact || services[0];
}

export async function fetchTosdrSummary(domain) {
  const cached = await getCached(domain);
  if (cached) return cached;

  const summary0 = baseSummary(domain);

  try {
    // 1) Search V5: /search/v5?query=...
    const searchRes = await fetch(`${TOSDR_API}/search/v5?query=${encodeURIComponent(domain)}`, {
      headers: { "Accept": "application/json" },
    });

    if (searchRes.status === 429) {
      return { ...summary0, status: "rate_limited" };
    }
    if (!searchRes.ok) {
      return { ...summary0, status: "api_error" };
    }

    const searchData = await searchRes.json();
    const service = pickBestService(searchData.services, domain);

    if (!service?.id) {
      await setCached(domain, summary0);
      return summary0;
    }

    // 2) Service V3 con lang (probamos es, si falla o no hay, en)
    const fetchService = async (lang) => {
      const url = `${TOSDR_API}/service/v3?id=${encodeURIComponent(service.id)}&lang=${lang}`;
      const res = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!res.ok) return null;
      return res.json();
    };

    let details = await fetchService("es");
    let language = "es";
    if (!details) {
      details = await fetchService("en");
      language = "en";
    }
    if (!details) {
      return { ...summary0, status: "api_error", serviceId: service.id, serviceName: service.name };
    }

    // Nota: en V3 "rating" suele ser letra A-E como string (ej. "E") :contentReference[oaicite:3]{index=3}
    const pointsRaw = Array.isArray(details.points) ? details.points : [];

    const points = pointsRaw
      .map((p) => ({
        id: String(p.id ?? ""),
        type: p.classification, // "good" | "bad" | "blocker" en muchos casos
        title: p.title || "",
        description: p.description || "",
        source: p.source,
      }))
      .filter((p) => p.id && p.type && (p.title || p.description));

    const summary = {
      ...summary0,
      serviceId: service.id,
      serviceName: service.name,
      grade: details.rating,     // V3 ejemplo: "E" :contentReference[oaicite:4]{index=4}
      rating: undefined,         // si no viene score numérico, lo dejamos vacío
      points,
      language,
      status: "ok",
      fetchedAt: Date.now(),
      expiresAt: Date.now() + DEFAULT_TTL,
    };

    await setCached(domain, summary);
    return summary;
  } catch {
    return { ...summary0, status: "api_error" };
  }
}
