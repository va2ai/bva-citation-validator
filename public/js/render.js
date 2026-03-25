function renderPanel(data, mode) {
  const isGrounded = mode === 'grounded';
  const label = isGrounded ? 'Grounded' : 'Ungrounded';
  const cls = isGrounded ? 'grounded' : 'ungrounded';

  const sources = data.find(s => s.step === 'sources')?.data;
  const gen = data.find(s => s.step === 'generation')?.data;
  const ext = data.find(s => s.step === 'extraction')?.data;
  const val = data.find(s => s.step === 'validation')?.data;
  const cri = data.find(s => s.step === 'critic')?.data;
  const adv = data.find(s => s.step === 'prompt_advisor')?.data;
  const sum = data.find(s => s.step === 'summary')?.data;

  // Store advisor prompt for copy button (keyed by mode to handle Compare Both)
  if (adv?.updated_prompt) {
    window._advisorPrompts[mode] = adv.updated_prompt;
  }

  return `
    <div class="result-panel">
      <div class="result-header ${cls}">
        <h2>${label} Generation</h2>
        <span style="font-size:10px;color:var(--text-muted)">${gen?.model || ''}</span>
      </div>

      <div class="step">
        <div class="step-label"><span class="step-num">1</span> Sentinel-tagged sources</div>
        <div class="source-tags">
          ${(sources?.sources || []).map(s => `<span class="source-tag">${s}</span>`).join('')}
        </div>
      </div>

      <div class="step">
        <div class="step-label"><span class="step-num">2</span> LLM Response</div>
        <div class="response-text">${escapeHtml(gen?.text || '')}</div>
        <div class="token-info">${gen?.tokens?.input || 0} tokens in / ${gen?.tokens?.output || 0} out</div>
      </div>

      <div class="step">
        <div class="step-label"><span class="step-num">3</span> Citation extraction &mdash; ${ext?.count || 0} citations found</div>
        <div class="token-info">${ext?.tokens?.input || 0} tokens in / ${ext?.tokens?.output || 0} out</div>
      </div>

      <div class="step">
        <div class="step-label"><span class="step-num">4</span> Cross-reference validation</div>
        ${(val?.results || []).map(r => `
          <div class="citation ${r.status}">
            <div class="citation-id">
              <span class="status-badge status-${r.status}">${r.status}</span>
              [${(r.type||'').toUpperCase()}] ${escapeHtml(r.identifier)}
            </div>
            <div class="citation-claim">${escapeHtml(r.claim || '')}</div>
            <div class="citation-detail">${escapeHtml(r.detail)}</div>
          </div>
        `).join('')}
      </div>

      <div class="step">
        <div class="step-label"><span class="step-num">5</span> Adversarial critic review &mdash; ${cri?.findings?.length || 0} findings</div>
        ${(cri?.findings || []).length === 0
          ? '<div style="font-size:12px;color:var(--green);padding:8px 0;">No issues found &mdash; critic confirms response quality.</div>'
          : (cri?.findings || []).map(f => `
          <div class="critic-finding severity-${f.severity}">
            <div class="critic-issue">
              <span class="severity-label ${f.severity}">${(f.severity||'').toUpperCase()}</span>
              ${escapeHtml(f.issue)}
            </div>
            <div class="critic-sentence">"${escapeHtml(f.sentence || '')}"</div>
            <div class="critic-suggestion">Suggestion: ${escapeHtml(f.suggestion || '')}</div>
          </div>
        `).join('')}
        <div class="token-info">${cri?.tokens?.input_tokens || 0} tokens in / ${cri?.tokens?.output_tokens || 0} out</div>
      </div>

      ${adv ? `
      <div class="step">
        <div class="step-label"><span class="step-num">6</span> Prompt advisor &mdash; ${adv.suggestions?.length || 0} suggestions</div>
        ${(adv.suggestions || []).length === 0
          ? '<div style="font-size:12px;color:var(--green);padding:8px 0;">No prompt improvements needed.</div>'
          : (adv.suggestions || []).map(s => `
          <div class="advisor-suggestion priority-${s.priority}">
            <div class="advisor-rule">
              <span class="severity-label ${s.priority}">${(s.priority||'').toUpperCase()}</span>
              ${escapeHtml(s.rule)}
            </div>
            <div class="advisor-rationale">${escapeHtml(s.rationale)}</div>
            <div class="advisor-addresses">Addresses: ${(s.addresses||[]).map(a => escapeHtml(a)).join(', ')}</div>
          </div>
        `).join('')}
        ${adv.updated_prompt ? `
          <div style="margin-top:10px;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--accent);">Suggested updated prompt:</div>
          <div class="updated-prompt">${escapeHtml(adv.updated_prompt)}</div>
          <button class="copy-btn" data-copy-prompt="${mode}">Copy to clipboard</button>
        ` : ''}
        <div class="token-info">${adv.tokens?.input_tokens || 0} tokens in / ${adv.tokens?.output_tokens || 0} out</div>
      </div>
      ` : ''}

      <div class="step">
        <div class="step-label"><span class="step-num">${adv ? '7' : '6'}</span> Summary</div>
        <div class="summary">
          <div class="summary-stat">
            <div class="num num-total">${sum?.total || 0}</div>
            <div class="label">Total</div>
          </div>
          <div class="summary-stat">
            <div class="num num-verified">${sum?.verified || 0}</div>
            <div class="label">Verified</div>
          </div>
          ${(sum?.outdated || 0) > 0 ? `
          <div class="summary-stat">
            <div class="num num-outdated">${sum.outdated}</div>
            <div class="label">Outdated</div>
          </div>` : ''}
          <div class="summary-stat">
            <div class="num num-warn">${sum?.notInSources || 0}</div>
            <div class="label">Unverified</div>
          </div>
          ${(sum?.ungrounded || 0) > 0 ? `
          <div class="summary-stat">
            <div class="num num-ungrounded">${sum.ungrounded}</div>
            <div class="label">Leaked</div>
          </div>` : ''}
          ${(sum?.hallucinated || 0) > 0 ? `
          <div class="summary-stat">
            <div class="num num-hallucinated">${sum.hallucinated}</div>
            <div class="label">Hallucinated</div>
          </div>` : ''}
          <div class="summary-stat">
            <div class="num" style="color:${(cri?.findings?.length || 0) > 0 ? 'var(--amber)' : 'var(--green)'}">${cri?.findings?.length || 0}</div>
            <div class="label">Critic Findings</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderScoreChart(iterations, height = 120) {
  if (iterations.length < 2) return '';
  const scores = iterations.map(i => i.score);
  const min = Math.max(0, Math.min(...scores) - 5);
  const max = Math.min(100, Math.max(...scores) + 5);
  const range = max - min || 1;
  const w = 600;
  const h = height;
  const pad = 24;

  // Build points for the line
  const points = scores.map((s, i) => {
    const x = pad + (i / (scores.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((s - min) / range) * (h - 2 * pad);
    return { x, y, score: s, improved: iterations[i].improved };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

  // Best score line
  const bestScore = Math.max(...scores);
  const bestY = h - pad - ((bestScore - min) / range) * (h - 2 * pad);

  // Grid lines
  const gridLines = [min, min + range * 0.25, min + range * 0.5, min + range * 0.75, max].map(v => {
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
            <text x="${pad - 4}" y="${y + 3}" fill="rgba(255,255,255,0.3)" font-size="9" text-anchor="end">${Math.round(v)}</text>`;
  }).join('');

  const dots = points.map(p =>
    `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${p.improved ? '#22c55e' : '#f59e0b'}" stroke="var(--bg)" stroke-width="2"/>
     <text x="${p.x}" y="${p.y - 10}" fill="var(--text-muted)" font-size="9" text-anchor="middle">${p.score}</text>`
  ).join('');

  return `
    <div class="score-chart">
      <div class="chart-label">Score over iterations</div>
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
        ${gridLines}
        <line x1="${pad}" y1="${bestY}" x2="${w - pad}" y2="${bestY}" stroke="rgba(34,197,94,0.2)" stroke-width="1" stroke-dasharray="4,4"/>
        <path d="${linePath}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>
        ${dots}
      </svg>
    </div>`;
}

function renderQueryBars(iterations) {
  if (!iterations.length) return '';
  const last = iterations[iterations.length - 1];
  const first = iterations[0];
  if (!last.queryScores || !first.queryScores) return '';

  return `
    <div class="score-chart">
      <div class="chart-label">Per-query scores (latest iteration)</div>
      <div class="query-bars">
        ${last.queryScores.map((q, i) => {
          const initial = first.queryScores[i]?.score ?? 0;
          const delta = q.score - initial;
          const barColor = q.score >= 80 ? 'var(--green)' : q.score >= 50 ? 'var(--amber)' : 'var(--red)';
          const shortQuery = q.query.length > 40 ? q.query.slice(0, 40) + '...' : q.query;
          return `
            <div class="query-bar-row">
              <span class="query-bar-label" title="${escapeHtml(q.query)}">${escapeHtml(shortQuery)}</span>
              <div class="query-bar-track">
                <div class="query-bar-fill" style="width:${q.score}%;background:${barColor};"></div>
              </div>
              <span class="query-bar-score" style="color:${barColor}">${q.score}</span>
              <span style="font-size:10px;min-width:35px;color:${delta > 0 ? 'var(--green)' : delta < 0 ? 'var(--red)' : 'var(--text-muted)'}">${delta > 0 ? '+' : ''}${delta.toFixed(0)}</span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderOptimizeProgress(iterations) {
  const el = document.getElementById('optimize-iterations');
  let prevScore = null;
  const rows = iterations.map((iter) => {
    const delta = prevScore !== null ? iter.score - prevScore : 0;
    const deltaStr = prevScore !== null
      ? (delta > 0 ? `+${delta.toFixed(1)}` : delta < 0 ? delta.toFixed(1) : '±0')
      : '—';
    const deltaClass = delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : 'delta-same';
    const rowClass = iter.convergedReason ? 'converged' : iter.improved ? 'improved' : 'reverted';
    prevScore = iter.score;
    return `
      <div class="iter-row ${rowClass}">
        <span class="iter-num">#${iter.iteration}</span>
        <span class="iter-score">${iter.score}</span>
        <span class="iter-delta ${deltaClass}">${deltaStr}</span>
        <span class="iter-stats">${iter.model ? iter.model.replace('claude-','').replace('-20251001','') + ' | ' : ''}${iter.totalCitations} cit, ${iter.totalFindings} findings</span>
        <span class="iter-status ${iter.improved ? 'status-kept' : 'status-reverted'}">${iter.improved ? 'KEPT' : 'REVERTED'}</span>
        ${iter.convergedReason ? `<span style="font-size:10px;color:var(--accent);">${escapeHtml(iter.convergedReason)}</span>` : ''}
      </div>`;
  }).join('');

  const lastLedger = iterations[iterations.length - 1]?.ledger;
  const ledgerHtml = lastLedger
    ? `<details class="ledger-box" open><summary>Optimization Ledger</summary><div class="ledger-content">${escapeHtml(lastLedger)}</div></details>`
    : '';

  el.innerHTML = renderScoreChart(iterations) + rows + ledgerHtml +
    `<div class="loading-msg"><span class="spinner"></span>Running iteration ${iterations.length}...
      <button class="copy-btn" style="margin-left:12px;color:var(--red);border-color:rgba(239,68,68,0.3);" onclick="stopOptimize()">Stop</button>
    </div>`;
}

function renderOptimizeResult(result, iterations) {
  const el = document.getElementById('optimize-iterations');
  // Remove the loading spinner
  const spinner = el.querySelector('.loading-msg');
  if (spinner) spinner.remove();

  // Re-render iterations without spinner, with final chart
  const el2 = document.getElementById('optimize-iterations');
  let prevScore2 = null;
  const finalRows = iterations.map((iter) => {
    const delta = prevScore2 !== null ? iter.score - prevScore2 : 0;
    const deltaStr = prevScore2 !== null
      ? (delta > 0 ? `+${delta.toFixed(1)}` : delta < 0 ? delta.toFixed(1) : '±0')
      : '—';
    const deltaClass = delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : 'delta-same';
    const rowClass = iter.convergedReason ? 'converged' : iter.improved ? 'improved' : 'reverted';
    prevScore2 = iter.score;
    return `
      <div class="iter-row ${rowClass}">
        <span class="iter-num">#${iter.iteration}</span>
        <span class="iter-score">${iter.score}</span>
        <span class="iter-delta ${deltaClass}">${deltaStr}</span>
        <span class="iter-stats">${iter.model ? iter.model.replace('claude-','').replace('-20251001','') + ' | ' : ''}${iter.totalCitations} cit, ${iter.totalFindings} findings</span>
        <span class="iter-status ${iter.improved ? 'status-kept' : 'status-reverted'}">${iter.improved ? 'KEPT' : 'REVERTED'}</span>
        ${iter.convergedReason ? `<span style="font-size:10px;color:var(--accent);">${escapeHtml(iter.convergedReason)}</span>` : ''}
      </div>`;
  }).join('');
  const finalLedger = iterations[iterations.length - 1]?.ledger;
  const finalLedgerHtml = finalLedger
    ? `<details class="ledger-box"><summary>Optimization Ledger — what the AI learned</summary><div class="ledger-content">${escapeHtml(finalLedger)}</div></details>`
    : '';

  el2.innerHTML = renderScoreChart(iterations, 140) + finalRows + renderQueryBars(iterations) + finalLedgerHtml;

  const improvement = result.bestScore - result.initialScore;
  const improvementColor = improvement > 0 ? 'var(--green)' : improvement < 0 ? 'var(--red)' : 'var(--text-muted)';

  // Store best prompt for button handlers
  window._optimizedPrompt = result.bestPrompt;

  document.getElementById('optimize-result').innerHTML = `
    <div class="optimize-result">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--accent);margin-bottom:12px;">Optimization Complete — ${result.totalIterations} iterations</div>
      <div class="score-comparison">
        <div class="score-box">
          <div class="num" style="color:var(--text-muted)">${result.initialScore}</div>
          <div class="label">Initial Score</div>
        </div>
        <div class="score-box">
          <div class="num" style="color:var(--green)">${result.bestScore}</div>
          <div class="label">Best Score</div>
        </div>
        <div class="score-box">
          <div class="num" style="color:${improvementColor}">${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}</div>
          <div class="label">Improvement</div>
        </div>
      </div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--accent);margin:12px 0 6px;">Optimized Prompt:</div>
      <div class="updated-prompt">${escapeHtml(result.bestPrompt)}</div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="copy-btn" id="opt-copy-btn">Copy to Clipboard</button>
        <button class="copy-btn" id="opt-apply-btn">Apply to Grounded Prompt</button>
      </div>
    </div>`;

  document.getElementById('opt-copy-btn').onclick = function() {
    navigator.clipboard.writeText(window._optimizedPrompt)
      .then(() => this.textContent = 'Copied!')
      .catch(() => this.textContent = 'Copy failed');
  };
  document.getElementById('opt-apply-btn').onclick = function() {
    document.getElementById('groundedPrompt').value = window._optimizedPrompt;
    this.textContent = 'Applied!';
  };
}
