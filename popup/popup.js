const headerEl = document.getElementById('header');
const contentEl = document.getElementById('content');
const analyzeBtn = document.getElementById('analyzeBtn');

let expanded = false;
let currentSummary = null;

analyzeBtn.addEventListener('click', analyze);

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs[0] || typeof tabs[0].id !== 'number') return null;
  return tabs[0].id;
}

async function analyze() {
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analizando…';
  contentEl.textContent = '';
  headerEl.textContent = '';
  expanded = false;

  try {
    const tabId = await getActiveTabId();
    if (tabId == null) {
      renderStatus('api_error', 'No se pudo detectar la pestaña activa.');
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_CURRENT_DOMAIN',
      tabId
    });

    if (response?.error) {
      renderStatus('api_error', response.error);
      return;
    }

    const summary = response?.summary;
    if (!summary) {
      renderStatus('api_error', 'No se pudo obtener el resumen.');
      return;
    }

    currentSummary = summary;
    render(summary);
  } catch (e) {
    renderStatus('api_error');
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Reintentar';
  }
}

function render(summary) {
  headerEl.textContent = '';
  contentEl.textContent = '';

  if (summary.status !== 'ok') {
    renderHeader(summary); // al menos dominio si existe
    renderStatus(summary.status);
    return;
  }

  renderHeader(summary);
  renderPoints(summary.points);
}

function renderHeader({ domain, serviceName, grade }) {
  if (!domain && !serviceName && !grade) return;

  if (domain) {
    const domainEl = document.createElement('div');
    domainEl.className = 'domain';
    domainEl.textContent = domain;
    headerEl.appendChild(domainEl);
  }

  if (serviceName) {
    const serviceEl = document.createElement('div');
    serviceEl.className = 'service';
    serviceEl.textContent = serviceName;
    headerEl.appendChild(serviceEl);
  }

  if (grade) {
    const gradeEl = document.createElement('div');
    gradeEl.className = 'grade ' + (grade === 'A' || grade === 'B' ? 'ok' : 'bad');
    gradeEl.textContent = `Grade: ${grade}`;
    headerEl.appendChild(gradeEl);
  }
}

function renderPoints(points = []) {
  if (!points.length) {
    const msg = document.createElement('div');
    msg.className = 'status';
    msg.textContent = 'No hay puntos públicos disponibles para este servicio en ToS;DR.';
    contentEl.appendChild(msg);
    return;
  }

  const ordered = [...points].sort((a, b) => severity(b.type) - severity(a.type));
  const visible = expanded ? ordered : ordered.slice(0, 6);

  visible.forEach(renderPoint);

  if (points.length > 6) {
    const toggle = document.createElement('button');
    toggle.textContent = expanded ? 'Ver menos' : 'Ver más';
    toggle.addEventListener('click', () => {
      expanded = !expanded;
      contentEl.textContent = '';
      renderPoints(points);
    });
    contentEl.appendChild(toggle);
  }
}

function renderPoint(point) {
  const card = document.createElement('div');
  card.className = `card ${point.type}`;

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = point.title || '(Sin título)';

  const desc = document.createElement('div');
  desc.className = 'card-desc';

  const fullText = point.description || '';
  const shortText = fullText.length > 160 ? fullText.slice(0, 160) + '…' : fullText;

  let collapsed = fullText.length > 160;
  desc.textContent = collapsed ? shortText : fullText;

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  if (collapsed) {
    const toggle = document.createElement('button');
    toggle.textContent = 'Ver detalle';
    toggle.addEventListener('click', () => {
      collapsed = !collapsed;
      desc.textContent = collapsed ? shortText : fullText;
      toggle.textContent = collapsed ? 'Ver detalle' : 'Ocultar';
    });
    actions.appendChild(toggle);
  }

  if (point.source) {
    const link = document.createElement('a');
    link.textContent = 'Ver fuente';
    link.href = point.source;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    actions.appendChild(link);
  }

  card.appendChild(title);
  card.appendChild(desc);
  card.appendChild(actions);

  contentEl.appendChild(card);
}

function renderStatus(status, extra) {
  const msg = document.createElement('div');
  msg.className = 'status';

  let text = '';
  switch (status) {
    case 'no_coverage':
      text = 'Este servicio no está cubierto todavía.';
      break;
    case 'rate_limited':
      text = 'Demasiadas peticiones. Intenta de nuevo en unos minutos.';
      break;
    default:
      text = 'No se pudo obtener la información.';
  }

  msg.textContent = extra ? `${text}\n${extra}` : text;
  contentEl.appendChild(msg);
}

function severity(type) {
  return type === 'blocker' ? 4
    : type === 'bad' ? 3
    : type === 'neutral' ? 2
    : 1;
}
