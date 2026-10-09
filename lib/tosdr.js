const TOSDR_HUMAN_URL = (id) => (id ? `https://tosdr.org/en/service/${id}` : null);

function normalizePointType(t) {
  const v = String(t || "").toLowerCase();
  if (v === "blocker" || v === "bad" || v === "good" || v === "neutral") return v;
  return "neutral";
}

function computeCounts(points) {
  const counts = { blocker: 0, bad: 0, good: 0, neutral: 0 };
  for (const p of points || []) {
    const type = normalizePointType(p.type);
    counts[type] += 1;
  }
  return counts;
}

// lib/tosdr.js
const TOSDR_API = "https://api.tosdr.org";
const CACHE_PREFIX = "tosdr:v2:"; // v2: invalida entradas con servicio/idioma erróneos
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24h

// Subdominios funcionales comunes
const COMMON_SUBDOMAINS = new Set([
  "www", "m", "mobile",
  "accounts", "account", "login", "auth", "sso",
  "help", "support", "docs",
  "blog", "status",
  "api", "dev", "staging", "sandbox",
  "app", "apps", "cdn", "static", "images", "img",
]);

// ccSLD típicos (second-level bajo ccTLD) -> ej: co.uk, com.au
const CC_SLD = new Set([
  "co", "com", "net", "org", "gov", "edu", "ac", "nic", "or", "ne", "go",
]);

// ccTLD comunes (prácticos)
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
  // IPv6 con corchetes: "[::1]" o "[::1]:8080"
  if (hostname.startsWith("[")) {
    const end = hostname.indexOf("]");
    return end > 0 ? hostname.slice(1, end) : hostname.slice(1);
  }
  // IPv6 sin corchetes: no hay puerto que quitar
  if ((hostname.match(/:/g) || []).length > 1) return hostname;
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

  // Caso ccTLD con ccSLD: foo.co.uk => 3 labels
  if (COMMON_CCTLD.has(tld) && CC_SLD.has(sld) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

// TLDs reservados para redes privadas/locales
const PRIVATE_TLDS = new Set(["local", "localhost", "internal", "lan", "home", "corp", "intranet", "test", "invalid", "arpa"]);

/**
 * isPublicDomain: false para localhost, IPs, hosts de intranet y TLDs privados.
 * Estos nunca se envían a ToS;DR (no tendrían cobertura y filtrarían nombres internos).
 */
export function isPublicDomain(domain) {
  const d = String(domain || "");
  if (!d || !d.includes(".")) return false;
  if (isIPv4(d) || isIPv6(d)) return false;
  return !PRIVATE_TLDS.has(d.split(".").pop());
}

/**
 * normalizeDomain:
 * - Entrada: URL o hostname
 * - Salida: dominio registrable (example.com, bbc.co.uk, etc.)
 * - No devuelve URL completa, solo dominio/host.
 */
export function normalizeDomain(urlOrHostname) {
  const rawHost = safeParseHostname(urlOrHostname);
  if (!rawHost) return null;

  const host = normalizeLabels(rawHost);

  // aceptamos localhost y hosts internos
  if (host === "localhost" || host.endsWith(".local")) return host;

  // IPs: devolvemos la IP (si no quieres soportarlo, return null)
  if (isIPv4(host) || isIPv6(host)) return host;

  // hosts sin punto (intranet)
  if (!host.includes(".")) return host;

  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return host;

  const candidates = [];
  candidates.push(registrableDomainFromLabels(parts));

  // si empieza por subdominios funcionales, probamos quitarlos
  let trimmed = [...parts];
  while (trimmed.length > 2 && COMMON_SUBDOMAINS.has(trimmed[0])) {
    trimmed.shift();
    candidates.push(registrableDomainFromLabels(trimmed));
  }

  // escoger el candidato “más largo” (más específico)
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

  // Reinyectar domain para la UI (no se guarda redundante)
  return { domain, ...entry.data };
}

export async function setCached(domain, data, ttl = DEFAULT_TTL) {
  const key = await getKey(domain);

  // Guardar sin domain (redundante y mejor para privacidad)
  const { domain: _domain, host: _host, path: _path, ...dataWithoutDomain } = data || {};

  const entry = { data: dataWithoutDomain, expiresAt: Date.now() + ttl };
  await chrome.storage.local.set({ [key]: entry });
}

function baseSummary(domain, host) {
  const now = Date.now();
  return {
    host: host || domain,
    domain,
    serviceId: undefined,
    serviceName: undefined,
    grade: undefined,
    rating: undefined,
    tosdrUrl: null,
    counts: { blocker: 0, bad: 0, good: 0, neutral: 0 },
    points: [],
    language: "en",
    status: "no_coverage",
    fetchedAt: now,
    expiresAt: now + DEFAULT_TTL,
  };
}


function extractDomainsFromService(item) {
  const raw = []
    .concat(item?.domains ?? [])
    .concat(item?.urls ?? [])
    .concat(item?.hostnames ?? [])
    .concat(item?.matches ?? []);

  const out = [];
  for (const v of raw) {
    if (!v) continue;
    if (typeof v === "string") {
      const d = normalizeDomain(v);
      if (d) out.push(d);
    } else if (typeof v === "object") {
      const maybe = v.domain || v.hostname || v.url;
      if (typeof maybe === "string") {
        const d = normalizeDomain(maybe);
        if (d) out.push(d);
      }
    }
  }
  return Array.from(new Set(out));
}

function nameSimilarity(a, b) {
  const A = String(a ?? "").toLowerCase();
  const B = String(b ?? "").toLowerCase();
  if (!A || !B) return 0;
  if (A === B) return 3;
  if (A.includes(B) || B.includes(A)) return 2;
  if (A.replace(/\s+/g, "").includes(B.replace(/\./g, ""))) return 1;
  return 0;
}

/**
 * pickBestService: solo acepta servicios cuyas urls coinciden con el dominio.
 * Sin coincidencia exacta devuelve null (=> no_coverage) en lugar de adivinar.
 */
export function pickBestService(normalizedDomain, services) {
  if (!Array.isArray(services) || services.length === 0) return null;

  const matches = services.filter((item) =>
    extractDomainsFromService(item).includes(normalizedDomain)
  );
  if (matches.length === 0) return null;

  // Varios servicios comparten dominio (ej. Google, Google Maps...):
  // preferimos el nombre más parecido; en empate se mantiene el orden de la API.
  const scored = matches.map((item, idx) => ({
    item,
    idx,
    score: nameSimilarity(item?.name ?? item?.title, normalizedDomain),
  }));
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return scored[0].item;
}

export async function fetchTosdrSummary(domain, host) {
  // Hosts privados: no se consulta la API
  if (!isPublicDomain(domain)) return baseSummary(domain, host);

  const cached = await getCached(domain);
  if (cached) {
    const points = (cached.points || []).map(p => ({ ...p, type: normalizePointType(p.type) }));
    const serviceId = cached.serviceId ?? null;

    return {
      ...cached,
      host: host || cached.host || domain,
      domain,
      tosdrUrl: TOSDR_HUMAN_URL(serviceId),
      points,
      counts: computeCounts(points),
    };
  }


  const summary0 = baseSummary(domain, host);

  try {
    // 1) Search V5
    const searchRes = await fetch(
      `${TOSDR_API}/search/v5?query=${encodeURIComponent(domain)}`,
      { headers: { "Accept": "application/json" } }
    );

    if (searchRes.status === 429) {
      return { ...summary0, status: "rate_limited" };
    }
    if (!searchRes.ok) {
      return { ...summary0, status: "api_error" };
    }

    const searchData = await searchRes.json();
    const service = pickBestService(domain, searchData?.services);

    if (!service?.id) {
      await setCached(domain, summary0);
      return summary0;
    }

    // 2) Service V3 con fallback de idioma
    const fetchService = async (lang) => {
      const url = `${TOSDR_API}/service/v3?id=${encodeURIComponent(service.id)}&lang=${lang}`;
      const res = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!res.ok) return null;
      return res.json();
    };

    let detailsEs = await fetchService("es");
    let detailsEn = null;

    const esPointsCount = Array.isArray(detailsEs?.points) ? detailsEs.points.length : 0;

    // si ES no trae puntos, probamos EN
    if (esPointsCount === 0) {
      detailsEn = await fetchService("en");
    }

    const enPointsCount = Array.isArray(detailsEn?.points) ? detailsEn.points.length : 0;

    let details = detailsEs;
    let language = "es";

    // Elegimos EN si tiene puntos y ES no
    if ((!details || esPointsCount === 0) && detailsEn && enPointsCount > 0) {
      details = detailsEn;
      language = "en";
    }

    // Si ES falló y EN existe, usamos EN aunque venga sin puntos
    if (!details && detailsEn) {
      details = detailsEn;
      language = "en";
    }

    if (!details) {
      return { ...summary0, status: "api_error", serviceId: service.id, serviceName: service.name };
    }

    const pointsRaw = Array.isArray(details.points) ? details.points : [];

    // Service V3: classification/title/description suelen vivir en point.case.*
    const points = pointsRaw
      .map((p) => ({
        id: String(p?.id ?? ""),
        type: normalizePointType(p?.case?.classification),
        title: p?.case?.localized_title || p?.case?.title || p?.title || "",
        localized: Boolean(p?.case?.localized_title),
        description: p?.case?.description || p?.analysis || "",
        source: p?.source,
      }))
      .filter((pt) => pt.id && pt.type && (pt.title || pt.description));

    // El idioma real depende de si la API trajo títulos traducidos
    if (language === "es" && !points.some((pt) => pt.localized)) language = "en";
    for (const pt of points) delete pt.localized;

    const summary = {
      ...summary0,
      host: host || summary0.host,
      serviceId: service.id,
      serviceName: service.name,
      grade: details.rating,
      tosdrUrl: TOSDR_HUMAN_URL(service.id),
      points,
      counts: computeCounts(points),
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
