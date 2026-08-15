/* Registro progresivo de la caché offline local de Toolisto. */
(function registerToolistoServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(function () {
      // La aplicación sigue siendo plenamente utilizable si el host no admite Service Workers.
    });
  });
}());
