const hdrEl = document.getElementById('hdr');
const contentEl = document.getElementById('content');
const analyzeBtn = document.getElementById('analyzeBtn');

const tabRisks = document.getElementById('tabRisks');
const tabBlockers = document.getElementById('tabBlockers');
const tabAll = document.getElementById('tabAll');

const countsEl = document.getElementById('counts');
const openTosdrEl = document.getElementById('openTosdr');

let currentSummary = null;
let expanded = false;
let activeFilter = 'risks'; // 'risks' | 'blockers' | 'all'

init();

function init() {
  tabRisks.addEventListener('click', () => setFilter('risks'));
  tabBlockers.addEventListener('click', () => setFilter('blockers'));
  tabAll.addEventListener('click', () => setFilter('all'));
  analyzeBtn.addEventListener('click', analyze);

  setTosdrLink(null);
  renderStatus('Pulsa “Analizar” para evaluar esta pestaña.');
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs[0] || typeof tabs[0].id !== 'number') return null;
  return tabs[0].id;
}

async function analyze() {
  analyzeBtn.textContent = 'Analizando…';
  analyzeBtn.disabled = true;

  try {
    const tabId = await getActiveTabId();
    if (tabId == null) throw new Error('No se pudo detectar la pestaña activa');

    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_CURRENT_DOMAIN',
      tabId
    });

    if (response?.error) throw new Error(response.error);

    const summary = response?.summary;
    currentSummary = summary || null;

    expanded = false;
    setFilter('risks', { silent: true }); // por defecto solo riesgos
    render(currentSummary);

    analyzeBtn.textContent = 'Reintentar';
  } catch (e) {
    currentSummary = null;
    setTosdrLink(null);
    hdrEl.textContent = '';
    renderStatus('No se pudo analizar esta página. Algunas páginas (chrome://, extensiones, nueva pestaña) no permiten análisis.');
    analyzeBtn.textContent = 'Reintentar';
  } finally {
    analyzeBtn.disabled = false;
  }
}

function setFilter(filter, opts = {}) {
  activeFilter = filter;
  expanded = false;

  tabRisks.setAttribute('aria-selected', filter === 'risks' ? 'true' : 'false');
  tabBlockers.setAttribute('aria-selected', filter === 'blockers' ? 'true' : 'false');
  tabAll.setAttribute('aria-selected', filter === 'all' ? 'true' : 'false');

  if (!opts.silent && currentSummary) render(currentSummary);
}

function render(summary) {
  contentEl.textContent = '';
  hdrEl.textContent = '';

  if (!summary || !summary.status) {
    setTosdrLink(null);
    renderStatus('Pulsa “Analizar” para evaluar esta pestaña.');
    return;
  }

  renderHeader(summary);

  // Link ToS;DR: preferimos tosdrUrl si existe
  setTosdrLink(summary.tosdrUrl || null, summary.serviceId);

  // Contadores: usa summary.counts si existe, sino calcula
  const points = Array.isArray(summary.points) ? summary.points : [];
  if (summary.counts) {
    renderCountsFromCounts(summary.counts);
  } else {
    renderCountsFromPoints(points);
  }

  if (summary.status !== 'ok') {
    renderNonOk(summary.status);
    return;
  }

  renderPoints(points);
}

function renderHeader(summary) {
  const host = safeString(summary.host);       // hostname real
  const registrable = safeString(summary.domain); // dominio registrable
  const serviceName = safeString(summary.serviceName);
  const grade = safeString(summary.grade);

  const hostEl = document.createElement('div');
  hostEl.className = 'host';
  hostEl.textContent = host || '(sin host)';

  const svcEl = document.createElement('div');
  svcEl.className = 'svc';

  const path = safeString(summary.path);

  // Heurística: si es google.com y la ruta apunta a flights/maps/etc.
  const hint = inferSubservice(registrable, path);

  if (hint) {
    const h = document.createElement('div');
    h.className = 'svc';
    h.textContent = `Subservicio: ${hint}`;
    hdrEl.appendChild(hostEl);
    hdrEl.appendChild(svcEl);
    if (grade) {
      const g = document.createElement('div');
      g.className = 'svc';
      g.textContent = `Grade: ${grade}`;
      hdrEl.appendChild(g);
    }
    hdrEl.appendChild(h);
    return;
  }


  if (serviceName) {
    const strong = document.createElement('strong');
    strong.textContent = serviceName;

    const tail = document.createElement('span');
    tail.textContent = registrable ? ` (${registrable})` : '';

    svcEl.textContent = 'Servicio: ';
    svcEl.appendChild(strong);
    svcEl.appendChild(tail);
  } else {
    svcEl.textContent = registrable ? `Servicio: ${registrable}` : 'Servicio: —';
  }

  // Opcional: muestra grade si existe
  if (grade) {
    const g = document.createElement('div');
    g.className = 'svc';
    g.textContent = `Grade: ${grade}`;
    hdrEl.appendChild(hostEl);
    hdrEl.appendChild(svcEl);
    hdrEl.appendChild(g);
    return;
  }

  hdrEl.appendChild(hostEl);
  hdrEl.appendChild(svcEl);
}

function renderCountsFromCounts(c) {
  const blocker = Number(c.blocker || 0);
  const bad = Number(c.bad || 0);
  const good = Number(c.good || 0);
  const neutral = Number(c.neutral || 0);
  countsEl.textContent = `Blocker (${blocker}) · Bad (${bad}) · Good (${good}) · Neutral (${neutral})`;
}

function renderCountsFromPoints(points) {
  const c = { blocker: 0, bad: 0, good: 0, neutral: 0 };
  for (const p of points) {
    const t = normalizeType(p?.type);
    c[t] += 1;
  }
  renderCountsFromCounts(c);
}

function renderNonOk(status) {
  let msg = 'No se pudo obtener la información.';
  if (status === 'no_coverage') msg = 'Este servicio no está cubierto todavía.';
  else if (status === 'rate_limited') msg = 'Demasiadas peticiones. Intenta de nuevo en unos minutos.';
  else if (status === 'api_error') msg = 'Error al consultar el servicio. Pulsa “Reintentar”.';
  renderStatus(msg);
}

function renderStatus(text) {
  contentEl.textContent = '';
  const box = document.createElement('div');
  box.className = 'status';
  box.textContent = String(text || '');
  contentEl.appendChild(box);
}

function renderPoints(points) {
  const ordered = [...points].sort((a, b) => severity(b?.type) - severity(a?.type));

  const filtered = ordered.filter((p) => {
    const t = normalizeType(p?.type);
    if (activeFilter === 'blockers') return t === 'blocker';
    if (activeFilter === 'all') return true;
    return t === 'blocker' || t === 'bad'; // risks
  });

  if (filtered.length === 0) {
    renderStatus('No hay puntos para este filtro.');
    return;
  }

  const visible = expanded ? filtered : filtered.slice(0, 6);
  for (const p of visible) renderPointCard(p);

  if (filtered.length > 6) {
    const wrap = document.createElement('div');
    wrap.className = 'moreWrap';

    const btn = document.createElement('button');
    btn.className = 'moreBtn';
    btn.type = 'button';
    btn.textContent = expanded ? 'Ver menos' : 'Ver más';

    btn.addEventListener('click', () => {
      expanded = !expanded;
      contentEl.textContent = '';
      renderPoints(points);
    });

    wrap.appendChild(btn);
    contentEl.appendChild(wrap);
  }
}

function renderPointCard(point) {
  const type = normalizeType(point?.type);
  const titleText = safeString(point?.title) || '(Sin título)';
  const descText = safeString(point?.description) || '';
  const source = safeString(point?.source);

  const card = document.createElement('div');
  card.className = `card ${type}`;

  const badge = document.createElement('span');
  badge.className = `badge ${type}`;
  badge.textContent = labelForType(type);

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = titleText;

  const desc = document.createElement('div');
  desc.className = 'card-desc';

  const { shortText, hasLong } = shorten(descText, 180);
  let collapsed = hasLong;
  desc.textContent = collapsed ? shortText : descText;

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  if (hasLong) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'action-btn';
    toggle.textContent = 'Ver detalle';

    toggle.addEventListener('click', () => {
      collapsed = !collapsed;
      desc.textContent = collapsed ? shortText : descText;
      toggle.textContent = collapsed ? 'Ver detalle' : 'Ocultar';
    });

    actions.appendChild(toggle);
  }

  if (source && isSafeHttpUrl(source)) {
    const link = document.createElement('a');
    link.className = 'action-link';
    link.textContent = 'Ver fuente';
    link.href = source;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    actions.appendChild(link);
  }

  card.appendChild(badge);
  card.appendChild(title);
  if (descText) card.appendChild(desc);
  if (actions.childNodes.length > 0) card.appendChild(actions);

  contentEl.appendChild(card);
}

function setTosdrLink(tosdrUrl, serviceId) {
  // preferimos tosdrUrl
  if (tosdrUrl && isSafeHttpUrl(tosdrUrl)) {
    openTosdrEl.textContent = 'Abrir ToS;DR';
    openTosdrEl.removeAttribute('aria-disabled');
    openTosdrEl.href = tosdrUrl;
    return;
  }

  // fallback: construir por serviceId
  if (serviceId || serviceId === 0) {
    const idStr = String(serviceId);
    const url = `https://tosdr.org/en/service/${encodeURIComponent(idStr)}`;
    openTosdrEl.textContent = 'Abrir ToS;DR';
    openTosdrEl.removeAttribute('aria-disabled');
    openTosdrEl.href = url;
    return;
  }

  // sin link
  openTosdrEl.textContent = 'Abrir ToS;DR';
  openTosdrEl.setAttribute('aria-disabled', 'true');
  openTosdrEl.href = '#';
}

function severity(type) {
  const t = normalizeType(type);
  if (t === 'blocker') return 4;
  if (t === 'bad') return 3;
  if (t === 'neutral') return 2;
  return 1;
}

function normalizeType(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'blocker' || t === 'bad' || t === 'good' || t === 'neutral') return t;
  return 'neutral';
}

function labelForType(type) {
  if (type === 'blocker') return 'BLOCKER';
  if (type === 'bad') return 'Riesgo';
  if (type === 'good') return 'Bueno';
  return 'Neutral';
}

function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function shorten(text, maxLen) {
  const t = String(text || '');
  if (t.length <= maxLen) return { shortText: t, hasLong: false };
  return { shortText: t.slice(0, maxLen) + '…', hasLong: true };
}

function isSafeHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}


function inferSubservice(registrableDomain, path) {
  const d = String(registrableDomain || '').toLowerCase();
  const p = String(path || '');

  if (d === 'google.com') {
    if (p.startsWith('/travel/flights')) return 'Google Flights';
    if (p.startsWith('/maps')) return 'Google Maps';
    if (p.startsWith('/search')) return 'Google Search';
    if (p.startsWith('/travel')) return 'Google Travel';
  }

  return '';
}
