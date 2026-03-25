function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window._advisorPrompts = {};
window._optimizedPrompt = null;

document.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-copy-prompt]');
  if (!btn) return;
  const key = btn.dataset.copyPrompt;
  const text = window._advisorPrompts[key];
  if (text) {
    navigator.clipboard.writeText(text)
      .then(() => btn.textContent = 'Copied!')
      .catch(() => btn.textContent = 'Copy failed');
  }
});
