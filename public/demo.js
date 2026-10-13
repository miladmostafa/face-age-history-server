(function () {
  const config = window.DEMO_CONFIG || {};
  const userInput = document.querySelector('#user-id');
  const statusEl = document.querySelector('#status');
  const listEl = document.querySelector('#scan-list');
  const buttons = ['#load-samples', '#export-user', '#delete-user'].map((selector) => document.querySelector(selector));

  const savedUser = localStorage.getItem('faceage-history-user');
  if (savedUser && userInput) userInput.value = savedUser;

  let client = null;
  let faceAge = null;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function userId() {
    return (userInput && userInput.value.trim()) || '';
  }

  function summarize(scan) {
    const analysis = (scan.payload && scan.payload.analysis) || {};
    const problems = Array.isArray(analysis.problems) ? analysis.problems : [];
    const labels = problems
      .slice(0, 4)
      .map((problem) => {
        if (!problem || typeof problem !== 'object') return '';
        const name = problem.title || problem.key || '';
        const score = problem.number != null ? ' ' + problem.number : '';
        return name + score;
      })
      .filter(Boolean);
    return {
      skinAge: analysis.skinAge == null ? '—' : String(analysis.skinAge),
      damage: analysis.damagePercentage == null ? '—' : String(analysis.damagePercentage),
      labels: labels.join(', '),
    };
  }

  function renderScans(scans) {
    if (!listEl) return;
    listEl.replaceChildren();
    if (!scans.length) {
      const empty = document.createElement('p');
      empty.className = 'meta';
      empty.textContent = 'No scans stored for this user yet.';
      listEl.appendChild(empty);
      return;
    }
    for (const scan of scans) {
      const card = document.createElement('article');
      card.className = 'scan';
      const summary = summarize(scan);
      const title = document.createElement('h3');
      title.textContent = 'Skin age ' + summary.skinAge + ' · damage ' + summary.damage + '%';
      const meta = document.createElement('p');
      meta.className = 'meta';
      meta.textContent = scan.analyzeRefToken + (summary.labels ? ' · ' + summary.labels : '');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Remove scan';
      remove.addEventListener('click', () => removeScan(scan.analyzeRefToken));
      card.append(title, meta, remove);
      listEl.appendChild(card);
    }
  }

  async function refresh() {
    if (!client) return;
    const scans = await client.list();
    renderScans(scans.scans || scans);
    return scans;
  }

  async function removeScan(token) {
    setStatus('Removing ' + token + '…');
    if (faceAge && faceAge.API && typeof faceAge.API.removeHistoryItem === 'function') {
      await faceAge.API.removeHistoryItem(token);
    } else if (client) {
      await client.deleteByToken(token);
    }
    await refresh();
    setStatus('Removed ' + token + '.');
  }

  function samplePayloads() {
    const day = 24 * 60 * 60 * 1000;
    return [
      {
        analysis: {
          analyze_ref_token: 'analyze_ref_demo_older',
          skinAge: 32,
          damagePercentage: 28.4,
          problems: [
            { key: 'fineWrinkles', title: 'Fine Wrinkles', number: 42 },
            { key: 'pores', title: 'Pores', number: 35 },
            { key: 'acne', title: 'Acne', number: 12 },
          ],
        },
        activeSelections: { skinType: 'combination' },
        meta: { ts: Date.now() - 30 * day },
      },
      {
        analysis: {
          analyze_ref_token: 'analyze_ref_demo_newer',
          skinAge: 29,
          damagePercentage: 21.1,
          problems: [
            { key: 'fineWrinkles', title: 'Fine Wrinkles', number: 30 },
            { key: 'pores', title: 'Pores', number: 33 },
            { key: 'acne', title: 'Acne', number: 8 },
          ],
        },
        activeSelections: { skinType: 'combination' },
        meta: { ts: Date.now() - day },
      },
    ];
  }

  async function openDemoSession(id) {
    const response = await fetch('/demo/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: id }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.accessToken) {
      throw new Error(body.message || 'Could not open a local demo session.');
    }
    return body.accessToken;
  }

  async function boot() {
    const id = userId();
    if (!id) {
      setStatus('Enter a local demo user id. A production store takes this from the login session.');
      return;
    }
    localStorage.setItem('faceage-history-user', id);
    if (typeof FaceAgeHistory === 'undefined') {
      setStatus('History helper is not available. Run the build so public/face-age-history.js exists.');
      return;
    }

    let accessToken;
    try {
      accessToken = await openDemoSession(id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not open a local demo session.');
      return;
    }

    client = FaceAgeHistory.createClient({ baseUrl: '', accessToken: accessToken });
    buttons.forEach((button) => {
      if (button) button.disabled = false;
    });

    try {
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load scans.');
    }

    if (!config.faceageId || typeof FaceAge !== 'function') {
      if (!config.faceageId) {
        setStatus('Set FACEAGE_CLIENT_ID from panel.getfaceage.com to render the widget. Stored scans are listed here.');
      } else {
        setStatus('The face-age script did not load. Check the network connection to jsDelivr.');
      }
      return;
    }

    const host = document.querySelector('#FaceAge-module');
    if (host) host.hidden = false;
    faceAge = new FaceAge({
      elementId: 'FaceAge-module',
      faceageId: config.faceageId,
      history: true,
      displayModel: 'section',
      height: '680px',
      quiz: true,
      showProducts: false,
      showRoutine: false,
      language: 'en',
    });

    try {
      const result = await FaceAgeHistory.attach(faceAge, {
        baseUrl: '',
        accessToken: accessToken,
        onSync: function () {
          refresh()
            .then(function () {
              setStatus('Saved this scan for this user.');
            })
            .catch(function (error) {
              setStatus(error.message);
            });
        },
        onRestore: function (count) {
          setStatus(count ? 'Restored ' + count + ' scan(s) into the Face Age Compare history.' : 'No saved scans for this user yet.');
        },
        onError: function (error) {
          setStatus(error.message);
        },
      });
      await faceAge.render();
      if (result && result.restored > 0) {
        setStatus('Restored ' + result.restored + ' scan(s). Open a past scan in the widget to use Compare.');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not attach history.');
    }
  }

  document.querySelector('#apply-user')?.addEventListener('click', () => {
    localStorage.setItem('faceage-history-user', userId());
    location.reload();
  });

  document.querySelector('#load-samples')?.addEventListener('click', async () => {
    if (!client) return;
    setStatus('Saving sample advisor payloads…');
    try {
      for (const payload of samplePayloads()) {
        await client.save(payload);
      }
      location.reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save samples.');
    }
  });

  document.querySelector('#export-user')?.addEventListener('click', async () => {
    if (!client) return;
    const data = await client.exportUser();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'face-age-history-' + userId() + '.json';
    link.click();
    URL.revokeObjectURL(url);
    setStatus('Export downloaded.');
  });

  document.querySelector('#delete-user')?.addEventListener('click', async () => {
    if (!client) return;
    if (!window.confirm('Delete every stored scan for this demo user?')) return;
    if (faceAge && faceAge.API) {
      await faceAge.API.removeHistoryItem(null);
    } else {
      await client.deleteUser();
    }
    await refresh();
    setStatus('All scans for this user were deleted.');
  });

  boot();
})();
