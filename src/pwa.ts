export interface PwaCallbacks {
  offlineReady: () => void;
  updateReady: (apply: () => void) => void;
  unavailable: () => void;
}

export async function setupPwa(callbacks: PwaCallbacks): Promise<void> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    callbacks.unavailable();
    return;
  }
  let applying = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) location.reload();
  });
  try {
    const registration = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI), {
      scope: new URL('./', document.baseURI).pathname,
      updateViaCache: 'none',
    });
    const reportUpdate = () => {
      if (!registration.waiting || !navigator.serviceWorker.controller) return;
      callbacks.updateReady(() => {
        if (!registration.waiting) { void registration.update().catch(() => {}); return; }
        applying = true;
        registration.waiting.postMessage({ type: 'APPLY_UPDATE' });
      });
    };
    reportUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') reportUpdate();
      });
    });
    const ready = await navigator.serviceWorker.ready;
    if (ready.active) {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event: MessageEvent<{ ready?: boolean }>) => {
        if (event.data?.ready) callbacks.offlineReady();
        channel.port1.close();
      };
      ready.active.postMessage({ type: 'CACHE_STATUS' }, [channel.port2]);
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        reportUpdate();
        void registration.update().catch(() => {});
      }
    });
  } catch {
    callbacks.unavailable();
  }
}
