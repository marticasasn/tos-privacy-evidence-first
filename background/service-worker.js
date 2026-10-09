import { normalizeDomain, fetchTosdrSummary } from "../lib/tosdr.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ANALYZE_CURRENT_DOMAIN") return;

  const tabId = message.tabId;
  if (typeof tabId !== "number") {
    sendResponse({ error: "tabId inválido" });
    return;
  }

chrome.scripting.executeScript(
  {
    target: { tabId },
    func: () => ({ host: location.hostname, path: location.pathname })
  },
  async (results) => {
    if (chrome.runtime.lastError) {
      sendResponse({ error: chrome.runtime.lastError.message });
      return;
    }

    const data = results?.[0]?.result;
    const host = data?.host;
    const path = data?.path;

    if (!host || typeof host !== "string") {
      sendResponse({ error: "No se pudo obtener el hostname de la página" });
      return;
    }

    const domain = normalizeDomain(host);
    if (!domain) {
      sendResponse({ error: "No se pudo normalizar el dominio" });
      return;
    }

    try {
      const summary = await fetchTosdrSummary(domain, host);

      // añadir contexto SOLO para UI (no lo guardes en cache)
      summary.path = (typeof path === "string") ? path : "";

      sendResponse({ summary });
    } catch (e) {
      // sin esto el popup se queda esperando una respuesta que nunca llega
      sendResponse({ error: e?.message || "Error inesperado al analizar" });
    }
  }
);


  return true;
});