const resultsEl = document.getElementById('results');
const buttons = document.querySelectorAll('.btn');

function setLoading(on) {
  buttons.forEach(b => b.disabled = on);
}

async function callValidate(query, grounded) {
  const model = document.getElementById('model').value;
  const groundedPrompt = document.getElementById('groundedPrompt').value;
  const ungroundedPrompt = document.getElementById('ungroundedPrompt').value;
  const systemPrompt = grounded ? groundedPrompt : ungroundedPrompt;
  const res = await fetch('/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, grounded, model, systemPrompt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function runSingle(grounded) {
  const query = document.getElementById('query').value;
  setLoading(true);
  resultsEl.innerHTML = `<div class="results-grid single"><div class="result-panel"><div class="loading-msg"><span class="spinner"></span>Running ${grounded ? 'grounded' : 'ungrounded'} validation...</div></div></div>`;
  try {
    const data = await callValidate(query, grounded);
    resultsEl.innerHTML = `<div class="results-grid single">${renderPanel(data, grounded ? 'grounded' : 'ungrounded')}</div>`;
  } catch (err) {
    resultsEl.innerHTML = `<div class="results-grid single"><div class="result-panel"><div class="loading-msg" style="color:var(--red)">Error: ${escapeHtml(err.message)}</div></div></div>`;
  }
  setLoading(false);
}

async function runBoth() {
  const query = document.getElementById('query').value;
  setLoading(true);
  resultsEl.innerHTML = `
    <div class="results-grid">
      <div class="result-panel"><div class="loading-msg"><span class="spinner"></span>Running grounded...</div></div>
      <div class="result-panel"><div class="loading-msg"><span class="spinner"></span>Waiting...</div></div>
    </div>`;

  let groundedData, ungroundedData;
  try {
    // Run sequentially to avoid rate limits
    groundedData = await callValidate(query, true);
    resultsEl.innerHTML = `
      <div class="results-grid">
        ${renderPanel(groundedData, 'grounded')}
        <div class="result-panel"><div class="loading-msg"><span class="spinner"></span>Running ungrounded...</div></div>
      </div>`;
    ungroundedData = await callValidate(query, false);
    resultsEl.innerHTML = `
      <div class="results-grid">
        ${renderPanel(groundedData, 'grounded')}
        ${renderPanel(ungroundedData, 'ungrounded')}
      </div>`;
  } catch (err) {
    resultsEl.innerHTML = `<div class="results-grid single"><div class="result-panel"><div class="loading-msg" style="color:var(--red)">Error: ${escapeHtml(err.message)}</div></div></div>`;
  }
  setLoading(false);
}

// Startup calls
checkResumeStatus();
loadPrompts();
checkInProgress();
