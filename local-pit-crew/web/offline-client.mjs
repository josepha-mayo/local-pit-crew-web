async function saveOfflineCopy(service) {
  const existing = await service.getRegistration();
  if (existing?.active?.state === 'activated') return;
  if (!navigator.onLine) throw Error('Reconnect to save the repair bench.');
  const registration = await service.register('/offline-worker.js', {updateViaCache: 'none'});
  const worker = registration.active ?? registration.installing ?? registration.waiting;
  if (!worker) throw Error('The browser could not start the offline download.');

  await new Promise((resolve, reject) => {
    function complete(error) {
      clearTimeout(timeout);
      worker.removeEventListener('statechange', check);
      if (error) reject(error);
      else resolve();
    }
    function check() {
      if (worker.state === 'activated') complete();
      if (worker.state === 'redundant') complete(Error('Offline download failed. Reconnect and try again.'));
    }
    const timeout = setTimeout(() => complete(Error('Offline download timed out. Try again when connected.')), 30_000);
    worker.addEventListener('statechange', check);
    check();
  });
}

export function bindOfflineCopy() {
  if (!('serviceWorker' in navigator)) return;
  const panel = document.getElementById('offline-bench');
  const button = document.getElementById('save-offline-bench');
  const status = document.getElementById('offline-bench-status');
  panel.hidden = false;
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Saving the bench and its verifier…';
    try {
      await saveOfflineCopy(navigator.serviceWorker);
      status.textContent = 'Offline copy saved. Keep this URL to reopen the bench offline.';
    } catch (error) {
      status.textContent = error.message || 'The offline copy could not be saved.';
    } finally {
      button.disabled = false;
    }
  });
}
