export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const units = ['B','KB','MB','GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** i);
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

export function shorten(text, length) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

export function hexToRgb(hex) {
  const clean = hex.replace('#','');
  const value = parseInt(clean,16);
  return { r:(value >> 16) & 255, g:(value >> 8) & 255, b:value & 255 };
}

export function parseTargetKb(text) {
  const q = String(text || '').toLowerCase().replace(/,/g,'.');
  const kb = q.match(/(\d+(?:\.\d+)?)\s*kb/);
  if (kb) return Math.round(Number(kb[1]));
  const mb = q.match(/(\d+(?:\.\d+)?)\s*mb/);
  if (mb) return Math.round(Number(mb[1]) * 1024);
  return 0;
}

export function extensionForMime(mime) {
  return mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
}

export function baseName(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9áéíóúüñ _-]/gi,'').trim() || 'toolisto';
}

export function valueOf(id, fallback) {
  return document.getElementById(id)?.value ?? fallback;
}

export function numberValue(id, fallback) {
  const value = Number(valueOf(id, fallback));
  return Number.isFinite(value) ? value : fallback;
}

export function controlNumber(id, label, value, min, max) {
  return `<div class="control"><label for="${id}">${label}</label><input id="${id}" type="number" value="${value}" min="${min}" max="${max}" /></div>`;
}

export function controlSelect(id, label, options) {
  return `<div class="control"><label for="${id}">${label}</label><select id="${id}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></div>`;
}

export function controlColor(id, label, value) {
  return `<div class="control"><label for="${id}">${label}</label><input id="${id}" type="color" value="${value}" /></div>`;
}

export function stripDiacritics(text) {
  return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
