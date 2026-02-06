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
      func: () => window.location.hostname
    },
    async (results) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }

      const hostname = results?.[0]?.result;
      const domain = normalizeDomain(hostname);

      if (!domain) {
        sendResponse({ error: "No se pudo normalizar el dominio" });
        return;
      }

      const summary = await fetchTosdrSummary(domain);
      sendResponse({ summary });
    }
  );

  return true;
});