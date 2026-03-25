// Check if there's an incomplete optimization to resume
async function checkResumeStatus() {
  try {
    const res = await fetch('/optimize/status');
    const { canResume, bestScore, iterations } = await res.json();
    const btn = document.getElementById('resumeBtn');
    if (canResume) {
      btn.style.display = '';
      btn.textContent = `Resume (iter ${iterations}, score ${bestScore})`;
    } else {
      btn.style.display = 'none';
    }
  } catch { /* ignore */ }
}

// Load active prompts from server (includes optimized prompt if available)
async function loadPrompts() {
  try {
    const res = await fetch('/prompts');
    const { grounded, ungrounded } = await res.json();
    if (grounded) document.getElementById('groundedPrompt').value = grounded;
    if (ungrounded) document.getElementById('ungroundedPrompt').value = ungrounded;
  } catch { /* ignore */ }
}

// Check for in-progress optimization and reconnect
async function checkInProgress() {
  try {
    const res = await fetch('/optimize/stream');
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('ndjson')) {
      // No active optimization
      return;
    }

    // There's an active optimization — show the UI and stream
    setLoading(true);
    resultsEl.innerHTML = `
      <div class="optimize-panel">
        <div class="optimize-header"><h2>Recursive Prompt Optimization (Autoresearch Pattern)</h2></div>
        <div class="optimize-body">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">Reconnected to in-progress optimization...</div>
          <div id="optimize-iterations"></div>
          <div id="optimize-result"></div>
        </div>
      </div>`;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const iterations = [];
    let finalResult = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.type === 'iteration') {
          iterations.push(msg.data);
          if (msg.data.improved && msg.data.prompt) {
            document.getElementById('groundedPrompt').value = msg.data.prompt;
          }
          renderOptimizeProgress(iterations);
        } else if (msg.type === 'result') {
          finalResult = msg.data;
        }
      }
    }

    if (finalResult) {
      renderOptimizeResult(finalResult, iterations);
      checkResumeStatus();
    }
    setLoading(false);
  } catch { /* no active optimization */ }
}

async function stopOptimize() {
  try {
    await fetch('/optimize/stop', { method: 'POST' });
  } catch { /* ignore */ }
}

async function runOptimize(resume) {
  setLoading(true);
  const prompt = document.getElementById('groundedPrompt').value;
  const model = document.getElementById('model').value;
  const optimizerModel = document.getElementById('optimizerModel').value;
  const maxIterations = parseInt(document.getElementById('maxIter').value) || 10;
  const modeLabel = resume ? 'Resuming incomplete optimization...' : `Query: ${model} | Optimizer: ${optimizerModel}`;

  resultsEl.innerHTML = `
    <div class="optimize-panel">
      <div class="optimize-header"><h2>Recursive Prompt Optimization (Autoresearch Pattern)</h2></div>
      <div class="optimize-body">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">
          ${modeLabel} &mdash; up to ${maxIterations} iterations across 4 test queries...
        </div>
        <div id="optimize-iterations">
          <div class="loading-msg"><span class="spinner"></span>Starting iteration 0...</div>
        </div>
        <div id="optimize-result"></div>
      </div>
    </div>`;

  try {
    const res = await fetch('/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, maxIterations, model, optimizerModel, resume: !!resume }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const iterations = [];
    let finalResult = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);

        if (msg.type === 'iteration') {
          iterations.push(msg.data);
          // Update grounded prompt textarea when optimizer finds an improvement
          if (msg.data.improved && msg.data.prompt) {
            document.getElementById('groundedPrompt').value = msg.data.prompt;
          }
          renderOptimizeProgress(iterations);
        } else if (msg.type === 'result') {
          finalResult = msg.data;
        } else if (msg.type === 'error') {
          throw new Error(msg.error);
        }
      }
    }

    if (finalResult) {
      renderOptimizeResult(finalResult, iterations);
      checkResumeStatus(); // hide resume button (run completed)
    }
  } catch (err) {
    document.getElementById('optimize-result').innerHTML =
      `<div style="color:var(--red);padding:12px;">Error: ${escapeHtml(err.message)}</div>`;
  }
  setLoading(false);
}
