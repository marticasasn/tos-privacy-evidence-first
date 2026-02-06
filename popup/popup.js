const analyzeBtn = document.getElementById('analyzeBtn');
const resultEl = document.getElementById('result');

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs[0] || typeof tabs[0].id !== 'number') return null;
  return tabs[0].id;
}

analyzeBtn.addEventListener('click', async () => {
  resultEl.textContent = 'Analizando…';

  try {
    const tabId = await getActiveTabId();
    if (tabId == null) {
      resultEl.textContent = 'No se pudo detectar la pestaña activa.';
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: "ANALYZE_CURRENT_DOMAIN",
      tabId
    });

    if (response?.error) {
      resultEl.textContent = `Error: ${response.error}`;
      return;
    }

    const s = response?.summary;
    if (!s) {
      resultEl.textContent = 'No se pudo obtener el resumen.';
      return;
    }

    if (s.status !== "ok") {
      resultEl.textContent =
        `Dominio: ${s.domain}\n` +
        `Estado: ${s.status}\n` +
        `No hay cobertura o hubo un error con ToS;DR.`;
      return;
    }
    
    resultEl.textContent =
      `Dominio: ${s.domain}\n` +
      (s.serviceName ? `Servicio: ${s.serviceName}\n` : "") +
      (s.grade ? `Grade: ${s.grade}\n` : "") +
      `Puntos: ${s.points?.length ?? 0}`;

  } catch (err) {
    console.error(err);
    resultEl.textContent = 'Error inesperado.';
  }
});
