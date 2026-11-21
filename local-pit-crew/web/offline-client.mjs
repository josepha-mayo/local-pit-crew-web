function waitUntilCached(worker, mayWait) {
  return new Promise((resolve, reject) => {
    function complete(error) {
      clearTimeout(timeout);
      worker.removeEventListener('statechange', check);
      if (error) reject(error);
      else resolve();
    }
    function check() {
      if (worker.state === 'activated' || (mayWait && worker.state === 'installed')) complete();
      if (worker.state === 'redundant') complete(Error('Offline download failed. Reconnect and try again.'));
    }
    const timeout = setTimeout(() => complete(Error('Offline download timed out. Try again when connected.')), 30_000);
    worker.addEventListener('statechange', check);
    check();
  });
}

async function saveOfflineCopy(service, version) {
  if (!/^[a-f0-9]{16}$/.test(version ?? '')) throw Error('Open the hosted bench to save an offline copy.');
  const cacheName = 'local-pit-crew-offline:' + version;
  const hasRelease = () => caches.match('/index.html', {cacheName});
  let registration = await service.getRegistration();
  if (!registration || !await hasRelease()) {
    if (!navigator.onLine) throw Error('Reconnect to save this version of the repair bench.');
    registration = registration ? await registration.update() : await service.register('/offline-worker.js', {updateViaCache: 'none'});
  }
  const worker = registration.installing ?? registration.waiting ?? registration.active;
  if (!worker) throw Error('The browser could not start the offline download.');
  const mayWait = Boolean(registration.active && worker !== registration.active);
  await waitUntilCached(worker, mayWait);
  if (!await hasRelease()) throw Error('This version could not be saved. Reopen the bench online and try again.');
  return {waiting: worker.state === 'installed'};
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
      const version = document.querySelector('meta[name="local-pit-crew-offline-build"]')?.content;
      const {waiting} = await saveOfflineCopy(navigator.serviceWorker, version);
      status.textContent = waiting
        ? 'Offline copy saved. Close all Local Pit Crew tabs before reopening offline to use this version.'
        : 'Offline copy saved. Keep this URL to reopen the bench offline.';
    } catch (error) {
      status.textContent = error.message || 'The offline copy could not be saved.';
    } finally {
      button.disabled = false;
    }
  });
}
