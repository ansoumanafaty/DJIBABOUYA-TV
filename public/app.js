const $ = id => document.getElementById(id);

let S = null;
let token = sessionStorage.getItem('djibabouya-token') || '';
let ws = null;
let clockTimer = null;
let reconnectTimer = null;

const deep = x => JSON.parse(JSON.stringify(x));

/* =========================
   AFFICHAGE DES ERREURS
========================= */

function showError(message) {
  console.error('[DJIBABOUYA TV]', message);

  let box = $('appError');

  if (!box) {
    box = document.createElement('div');
    box.id = 'appError';

    Object.assign(box.style, {
      position: 'fixed',
      left: '12px',
      right: '12px',
      bottom: '12px',
      zIndex: '99999',
      background: '#b00020',
      color: '#fff',
      padding: '14px 16px',
      borderRadius: '10px',
      fontFamily: 'Arial,sans-serif',
      fontSize: '15px',
      fontWeight: '700',
      boxShadow: '0 4px 20px rgba(0,0,0,.35)',
      display: 'none'
    });

    document.body.appendChild(box);
  }

  box.textContent = '⚠️ ' + message;
  box.style.display = 'block';

  clearTimeout(box._timer);
  box._timer = setTimeout(() => {
    box.style.display = 'none';
  }, 7000);
}

function showSuccess(message) {
  console.log('[DJIBABOUYA TV]', message);

  let box = $('appSuccess');

  if (!box) {
    box = document.createElement('div');
    box.id = 'appSuccess';

    Object.assign(box.style, {
      position: 'fixed',
      left: '12px',
      right: '12px',
      bottom: '12px',
      zIndex: '99998',
      background: '#087f23',
      color: '#fff',
      padding: '14px 16px',
      borderRadius: '10px',
      fontFamily: 'Arial,sans-serif',
      fontSize: '15px',
      fontWeight: '700',
      boxShadow: '0 4px 20px rgba(0,0,0,.35)',
      display: 'none'
    });

    document.body.appendChild(box);
  }

  box.textContent = '✓ ' + message;
  box.style.display = 'block';

  clearTimeout(box._timer);
  box._timer = setTimeout(() => {
    box.style.display = 'none';
  }, 3000);
}

/* =========================
   API
========================= */

const api = async (path, opt = {}) => {
  const headers = {
    ...(opt.headers || {})
  };

  /*
   * Le token est envoyé uniquement s'il existe.
   * Cela évite d'envoyer un header vide.
   */
  if (token) {
    headers['x-admin-token'] = token;
  }

  let response;

  try {
    response = await fetch(path, {
      cache: 'no-store',
      ...opt,
      headers
    });
  } catch (e) {
    throw new Error('Impossible de contacter le serveur.');
  }

  const contentType = response.headers.get('content-type') || '';

  let data = {};

  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => ({}));
  } else {
    const text = await response.text().catch(() => '');
    data = text ? { error: text } : {};
  }

  if (!response.ok) {
    if (response.status === 401) {
      /*
       * Si Cloudflare refuse le token,
       * on supprime le token local.
       */
      token = '';
      sessionStorage.removeItem('djibabouya-token');
      throw new Error(
        data.error || 'Session Admin invalide. Veuillez vous reconnecter.'
      );
    }

    throw new Error(
      data.error ||
      `Erreur serveur (${response.status}).`
    );
  }

  return data;
};

/* =========================
   DÉMARRAGE
========================= */

async function boot() {
  try {
    S = await api('/api/state');

    render();
    connectWS();

    setInterval(refreshLive, 10000);
    refreshLive();

    console.log('DJIBABOUYA TV : application démarrée.');
  } catch (e) {
    $('connection').textContent = '● Erreur de démarrage';
    showError(e.message);
    console.error(e);
  }
}

/* =========================
   WEBSOCKET
========================= */

function connectWS() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    try {
      ws.close();
    } catch {}
  }

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';

  try {
    ws = new WebSocket(
      `${proto}://${location.host}/ws`
    );
  } catch (e) {
    $('connection').textContent = '● WebSocket indisponible';
    scheduleReconnect();
    return;
  }

  $('connection').textContent = '● Connexion temps réel…';

  ws.onopen = () => {
    $('connection').textContent =
      '● Synchronisé en temps réel';
  };

  ws.onmessage = e => {
    try {
      const d = JSON.parse(e.data);

      if (d.type === 'state' && d.state) {
        S = d.state;
        render();
      }
    } catch (err) {
      console.error('Erreur WebSocket:', err);
    }
  };

  ws.onclose = () => {
    $('connection').textContent = '● Reconnexion…';
    scheduleReconnect();
  };

  ws.onerror = () => {
    try {
      ws.close();
    } catch {}
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWS();
  }, 1500);
}

/* =========================
   PUBLICATION ÉTAT
========================= */

async function publish(mutator) {
  if (!token) {
    const message = 'Connectez-vous à l’Admin avant de modifier le direct.';
    showError(message);

    try {
      $('login').showModal();
    } catch {}

    throw new Error(message);
  }

  if (!S) {
    const message = 'État du direct indisponible.';
    showError(message);
    throw new Error(message);
  }

  const n = deep(S);

  try {
    await mutator(n);

    const d = await api('/api/state', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        state: n
      })
    });

    if (!d || !d.state) {
      throw new Error(
        'Le serveur n’a pas renvoyé le nouvel état.'
      );
    }

    S = d.state;

    render();

    return d.state;

  } catch (e) {
    showError(e.message || 'Impossible d’enregistrer la modification.');
    throw e;
  }
}

/* =========================
   CHRONOMÈTRE
========================= */

function elapsed() {
  if (!S) return 0;

  let x = Number(S.elapsed) || 0;

  if (S.running && S.startedAt) {
    x += (Date.now() - S.startedAt) / 1000;
  }

  return Math.max(0, Math.floor(x));
}

function extraElapsed() {
  if (!S) return 0;

  let x = Number(S.extraElapsed) || 0;

  if (S.extraRunning && S.extraStartedAt) {
    x += (Date.now() - S.extraStartedAt) / 1000;
  }

  return Math.max(0, Math.floor(x));
}

const fmt = x =>
  `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(
    Math.max(0, x % 60)
  ).padStart(2, '0')}`;

/* =========================
   PUBLICATIONS TEMPORISÉES
========================= */

function timed(obj, key) {
  if (!obj) return false;

  if (!obj.visible) {
    return false;
  }

  if (!obj.startedAt || !obj.duration) {
    return true;
  }

  return Date.now() - obj.startedAt <
    Number(obj.duration) * 1000;
}

/* =========================
   AFFICHAGE TV
========================= */

function render() {
  if (!S) return;

  const bg = $('bg');

  if (bg) {
    bg.style.backgroundImage =
      `url("${S.background || '/default-background.jpg'}")`;

    bg.style.backgroundSize =
      S.backgroundMode || 'cover';
  }

  $('homeName').textContent =
    S.home?.name || 'A';

  $('awayName').textContent =
    S.away?.name || 'B';

  $('score').textContent =
    `${Number(S.home?.score) || 0} - ${Number(S.away?.score) || 0}`;

  $('homeBox').style.background =
    S.home?.color || '#0b63ce';

  $('awayBox').style.background =
    S.away?.color || '#d4a800';

  $('homeBox').style.color =
    S.home?.text || '#ffffff';

  $('awayBox').style.color =
    S.away?.text || '#111111';

  for (const [id, url] of [
    ['homeLogo', S.home?.logo],
    ['awayLogo', S.away?.logo]
  ]) {
    const e = $(id);

    if (!e) continue;

    e.src = url || '';
    e.style.display = url ? 'block' : 'none';
  }

  $('scoreboard').hidden =
    !S.scoreboardVisible;

  $('clock').textContent =
    fmt(elapsed());

  $('extra').textContent =
    S.extraMinutes ? `+${S.extraMinutes}` : '';

  $('ticker').hidden =
    !S.messageVisible;

  $('ticker').textContent =
    S.message || '';

  /* PUBLICITÉ */

  const a = S.ad || {};
  const showAd = timed(a, 'ad');

  $('adOverlay').hidden = !showAd;
  $('adImage').hidden = true;
  $('adVideo').hidden = true;

  $('adTitle').textContent =
    a.title || '';

  $('adText').textContent =
    a.text || '';

  if (a.kind === 'image' && a.image) {
    $('adImage').src = a.image;
    $('adImage').hidden = false;
  }

  if (a.kind === 'video' && a.video) {
    const v = $('adVideo');

    if (v.src !== location.origin + a.video) {
      v.src = a.video;
    }

    v.hidden = false;
  }

  /* REPLAY */

  const r = S.replay || {};
  const showReplay = timed(r, 'replay');

  $('replayOverlay').hidden =
    !showReplay;

  if (showReplay && r.url) {
    const v = $('replayVideo');

    if (v.src !== r.url) {
      v.src = r.url;
      v.playbackRate = Number(r.speed) || 1;

      v.play().catch(() => {});
    }
  }

  /* REMPLACEMENT */

  const sub = S.substitution || {};
  const showSub = timed(sub, 'substitution');

  $('subOverlay').hidden =
    !showSub;

  $('subOutPhoto').src =
    sub.out?.photo || '';

  $('subInPhoto').src =
    sub.in?.photo || '';

  $('subOutName').textContent =
    sub.out?.name || '';

  $('subOutNumber').textContent =
    sub.out?.number || '';

  $('subInName').textContent =
    sub.in?.name || '';

  $('subInNumber').textContent =
    sub.in?.number || '';

  /* COMPOSITION */

  const lineup = S.lineup || {};

  $('lineupOverlay').hidden =
    !lineup.visible;

  $('lineupTitle').textContent =
    `COMPOSITION — ${
      lineup.team === 'home'
        ? S.home.name
        : S.away.name
    } (${lineup.formation || '4-3-3'})`;

  const players =
    Array.isArray(lineup.players)
      ? lineup.players
      : [];

  $('pitch').innerHTML =
    players
      .map(x =>
        `<div class="player">${escapeHtml(
          typeof x === 'string'
            ? x
            : x?.name || 'Joueur'
        )}</div>`
      )
      .join('');

  /* AFFICHE */

  const poster = S.poster || {};

  $('posterOverlay').hidden =
    !poster.visible;

  $('posterImage').src =
    poster.image || '';

  /* VAR */

  const vr = S.var || {};

  $('varOverlay').hidden =
    !vr.visible;

  $('varTitle').textContent =
    vr.title || 'VAR';

  $('varText').textContent =
    vr.text || '';

  /* TIRS AU BUT */

  const penalty = S.penalty || {};

  $('penaltyOverlay').hidden =
    !penalty.visible;

  $('penaltyScore').textContent =
    `${Number(penalty.home) || 0} - ${
      Number(penalty.away) || 0
    }`;

  /* CHRONOMÈTRE */

  clearInterval(clockTimer);

  clockTimer = setInterval(() => {
    if (!S) return;

    $('clock').textContent =
      fmt(elapsed());

    $('extra').textContent =
      S.extraMinutes
        ? `+${S.extraMinutes}`
        : '';

    renderTimed();

  }, 1000);
}

function renderTimed() {
  if (!S) return;

  $('adOverlay').hidden =
    !timed(S.ad, 'ad');

  $('replayOverlay').hidden =
    !timed(S.replay, 'replay');

  $('subOverlay').hidden =
    !timed(S.substitution, 'substitution');
}

/* =========================
   SÉCURITÉ HTML
========================= */

function escapeHtml(s) {
  return String(s ?? '').replace(
    /[&<>"]/g,
    c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;'
    }[c])
  );
}

/* =========================
   UPLOAD
========================= */

async function upload(file) {
  if (!file) {
    throw new Error('Aucun fichier sélectionné.');
  }

  const fd = new FormData();

  fd.append('file', file);

  try {
    const d = await api('/api/media', {
      method: 'POST',
      body: fd
    });

    if (!d.url) {
      throw new Error(
        'Le serveur n’a pas fourni l’adresse du fichier.'
      );
    }

    return d.url;

  } catch (e) {
    showError(
      `Upload impossible : ${e.message}`
    );

    throw e;
  }
}

/* =========================
   ADMIN
========================= */

function adminOpen() {
  if (token) {
    $('admin').showModal();
  } else {
    $('login').showModal();
  }
}

$('adminButton').onclick = adminOpen;

/* =========================
   CONNEXION
========================= */

$('loginForm').addEventListener(
  'submit',
  async e => {
    e.preventDefault();

    $('loginError').textContent = '';

    try {
      const d = await api('/api/auth', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          password: $('password').value
        })
      });

      if (!d.ok || !d.token) {
        throw new Error(
          d.error || 'Connexion Admin refusée.'
        );
      }

      token = d.token;

      sessionStorage.setItem(
        'djibabouya-token',
        token
      );

      $('password').value = '';

      $('login').close();
      $('admin').showModal();

      showSuccess('Admin connecté.');

    } catch (e) {
      $('loginError').textContent =
        e.message;

      showError(e.message);
    }
  }
);

$('closeAdmin').onclick = () => {
  $('admin').close();
};

/* =========================
   ÉQUIPES
========================= */

$('saveTeams').onclick = async () => {
  try {
    await publish(s => {
      s.home.name =
        $('homeInput').value || 'A';

      s.away.name =
        $('awayInput').value || 'B';

      s.status =
        $('statusInput').value;
    });

    showSuccess('Équipes mises à jour.');
  } catch {}
};

/* =========================
   SCORE
========================= */

$('homePlus').onclick = async () => {
  try {
    await publish(s => {
      s.home.score++;
    });

    showSuccess('Score A +1');
  } catch {}
};

$('homeMinus').onclick = async () => {
  try {
    await publish(s => {
      s.home.score =
        Math.max(0, s.home.score - 1);
    });

    showSuccess('Score A -1');
  } catch {}
};

$('awayPlus').onclick = async () => {
  try {
    await publish(s => {
      s.away.score++;
    });

    showSuccess('Score B +1');
  } catch {}
};

$('awayMinus').onclick = async () => {
  try {
    await publish(s => {
      s.away.score =
        Math.max(0, s.away.score - 1);
    });

    showSuccess('Score B -1');
  } catch {}
};

/* =========================
   CHRONOMÈTRE
========================= */

$('startClock').onclick = async () => {
  try {
    await publish(s => {
      if (!s.running) {
        s.running = true;
        s.startedAt = Date.now();
      }
    });

    showSuccess('Chronomètre démarré.');
  } catch {}
};

$('stopClock').onclick = async () => {
  try {
    await publish(s => {
      if (s.running) {
        s.elapsed += Math.floor(
          (Date.now() - s.startedAt) / 1000
        );

        s.running = false;
        s.startedAt = 0;
      }
    });

    showSuccess('Chronomètre en pause.');
  } catch {}
};

$('resetClock').onclick = async () => {
  try {
    await publish(s => {
      s.elapsed = 0;
      s.startedAt = 0;
      s.running = false;
      s.extraElapsed = 0;
      s.extraRunning = false;
      s.extraStartedAt = 0;
    });

    showSuccess('Chronomètre réinitialisé.');
  } catch {}
};

$('saveExtra').onclick = async () => {
  try {
    await publish(s => {
      s.extraMinutes =
        Number($('extraInput').value) || 0;
    });

    showSuccess('Temps additionnel publié.');
  } catch {}
};

$('scoreVisible').onchange = async e => {
  try {
    await publish(s => {
      s.scoreboardVisible =
        e.target.checked;
    });
  } catch {}
};

/* =========================
   ÉVÉNEMENTS
========================= */

function eventData() {
  return {
    player: $('eventPlayer').value,
    minute:
      Number($('eventMinute').value) || 0,
    team: $('eventTeam').value,
    createdAt: Date.now(),
    id: crypto.randomUUID()
  };
}

$('goalBtn').onclick = async () => {
  try {
    await publish(s => {
      const g = eventData();

      s.goals.push(g);

      s.events.push({
        ...g,
        type: 'goal'
      });

      s[g.team].score++;
    });

    showSuccess('But publié.');
  } catch {}
};

document
  .querySelectorAll('.cardBtn')
  .forEach(b => {
    b.onclick = async () => {
      try {
        await publish(s => {
          const e = eventData();

          s.cards.push({
            ...e,
            type: b.dataset.card
          });

          s.events.push({
            ...e,
            type: b.dataset.card
          });
        });

        showSuccess('Carton publié.');
      } catch {}
    };
  });

$('halfBtn').onclick = async () => {
  try {
    await publish(s => {
      s.status = 'MI-TEMPS';
      s.running = false;
      s.startedAt = 0;
      s.period = 'MI-TEMPS';
    });

    showSuccess('Mi-temps publiée.');
  } catch {}
};

$('fullBtn').onclick = async () => {
  try {
    await publish(s => {
      s.status = 'TERMINÉ';
      s.running = false;
      s.startedAt = 0;
      s.period = 'FIN';
    });

    showSuccess('Fin du match publiée.');
  } catch {}
};

$('varBtn').onclick = async () => {
  try {
    await publish(s => {
      s.var.visible = !s.var.visible;
      s.var.title = 'VAR';
      s.var.text =
        s.var.visible
          ? 'DÉCISION EN COURS'
          : '';

      s.var.publicationId =
        crypto.randomUUID();
    });

    showSuccess(
      S.var.visible
        ? 'VAR affichée.'
        : 'VAR retirée.'
    );
  } catch {}
};

/* =========================
   STATISTIQUES
========================= */

$('saveStats').onclick = async () => {
  try {
    await publish(s => {
      s.stats.possessionHome =
        Number($('posH').value) || 0;

      s.stats.possessionAway =
        Number($('posA').value) || 0;

      s.stats.shotsHome =
        Number($('shotsH').value) || 0;

      s.stats.shotsAway =
        Number($('shotsA').value) || 0;

      s.stats.cornersHome =
        Number($('cornersH').value) || 0;

      s.stats.cornersAway =
        Number($('cornersA').value) || 0;
    });

    showSuccess('Statistiques publiées.');
  } catch {}
};

/* =========================
   MESSAGE
========================= */

$('publishMessage').onclick = async () => {
  try {
    await publish(s => {
      s.message =
        $('messageInput').value;

      s.messageVisible = true;
    });

    showSuccess('Message publié.');
  } catch {}
};

$('removeMessage').onclick = async () => {
  try {
    await publish(s => {
      s.message = '';
      s.messageVisible = false;
    });

    showSuccess('Message retiré.');
  } catch {}
};

/* =========================
   PUBLICITÉ
========================= */

$('publishAd').onclick = async () => {
  try {
    const f =
      $('adFile').files[0];

    const url =
      f ? await upload(f) : '';

    await publish(s => {
      s.ad = {
        visible: true,

        kind:
          f?.type.startsWith('video/')
            ? 'video'
            : f
              ? 'image'
              : 'text',

        title:
          $('adTitleInput').value,

        text:
          $('adTextInput').value,

        image:
          f &&
          !f.type.startsWith('video/')
            ? url
            : '',

        video:
          f &&
          f.type.startsWith('video/')
            ? url
            : '',

        startedAt:
          Date.now(),

        duration:
          Number(
            $('adDurationInput').value
          ) || 0,

        publicationId:
          crypto.randomUUID()
      };
    });

    showSuccess('Publicité publiée.');
  } catch {}
};

$('stopAd').onclick = async () => {
  try {
    await publish(s => {
      s.ad.visible = false;
    });

    showSuccess('Publicité retirée.');
  } catch {}
};

/* =========================
   REPLAY
========================= */

async function doReplay(slow) {
  $('replayStatus').textContent =
    'Création du clip…';

  try {
    const d = await api(
      '/api/live/replay',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          before:
            $('replayBefore').value,

          after:
            $('replayAfter').value
        })
      }
    );

    if (!d.url) {
      throw new Error(
        'Cloudflare n’a pas fourni le clip.'
      );
    }

    await publish(s => {
      const speed =
        slow
          ? Number(
              $('replaySpeed').value
            ) || 0.5
          : 1;

      s.replay = {
        visible: true,
        url: d.url,
        startedAt: Date.now(),

        duration:
          d.duration *
          (slow ? 1 / speed : 1),

        speed,

        publicationId:
          crypto.randomUUID()
      };
    });

    $('replayStatus').textContent =
      '✓ Replay publié instantanément';

    showSuccess('Replay publié.');

  } catch (e) {
    $('replayStatus').textContent =
      '✕ ' + e.message;

    showError(e.message);
  }
}

$('liveReplay').onclick =
  () => doReplay(false);

$('liveSlow').onclick =
  () => doReplay(true);

$('stopReplay').onclick = async () => {
  try {
    await publish(s => {
      s.replay.visible = false;
    });

    showSuccess('Replay retiré.');
  } catch {}
};

/* =========================
   REMPLACEMENT
========================= */

$('publishSub').onclick = async () => {
  try {
    const out =
      await upload(
        $('subOutFile').files[0]
      );

    const inn =
      await upload(
        $('subInFile').files[0]
      );

    await publish(s => {
      s.substitution = {
        visible: true,

        out: {
          name:
            $('subOutName').value,

          number:
            $('subOutNumber').value,

          photo: out
        },

        in: {
          name:
            $('subInName').value,

          number:
            $('subInNumber').value,

          photo: inn
        },

        startedAt:
          Date.now(),

        duration: 12,

        publicationId:
          crypto.randomUUID()
      };
    });

    showSuccess(
      'Remplacement publié.'
    );

  } catch {}
};

$('stopSub').onclick = async () => {
  try {
    await publish(s => {
      s.substitution.visible = false;
    });

    showSuccess(
      'Remplacement retiré.'
    );
  } catch {}
};

/* =========================
   COMPOSITION
========================= */

$('publishLineup').onclick = async () => {
  try {
    await publish(s => {
      s.lineup = {
        visible: true,
        team: 'home',

        formation:
          $('formation').value,

        players:
          $('lineupPlayers')
            .value
            .split('\n')
            .map(x => x.trim())
            .filter(Boolean),

        publicationId:
          crypto.randomUUID()
      };
    });

    showSuccess(
      'Composition publiée.'
    );

  } catch {}
};

$('stopLineup').onclick = async () => {
  try {
    await publish(s => {
      s.lineup.visible = false;
    });

    showSuccess(
      'Composition retirée.'
    );
  } catch {}
};

/* =========================
   AFFICHE
========================= */

$('publishPoster').onclick = async () => {
  try {
    const file =
      $('posterFile').files[0];

    const u =
      await upload(file);

    await publish(s => {
      s.poster = {
        visible: true,
        image: u,
        publicationId:
          crypto.randomUUID()
      };
    });

    showSuccess(
      'Affiche publiée sur la TV.'
    );

  } catch {}
};

$('stopPoster').onclick = async () => {
  try {
    await publish(s => {
      s.poster.visible = false;
    });

    showSuccess('Affiche retirée.');
  } catch {}
};

/* =========================
   FOND TV
========================= */

$('changeBackground').onclick = async () => {
  try {
    const file =
      $('backgroundFile').files[0];

    const u =
      await upload(file);

    await publish(s => {
      s.background = u;

      s.backgroundMode =
        $('backgroundMode').value;
    });

    showSuccess(
      'Fond TV changé.'
    );

  } catch {}
};

$('removeBackground').onclick = async () => {
  try {
    await publish(s => {
      s.background =
        '/default-background.jpg';

      s.backgroundMode =
        $('backgroundMode').value;
    });

    showSuccess(
      'Fond DJIBABOUYA restauré.'
    );

  } catch {}
};

$('backgroundMode').onchange =
  async e => {
    try {
      await publish(s => {
        s.backgroundMode =
          e.target.value;
      });

      showSuccess(
        'Mode d’affichage modifié.'
      );

    } catch {}
  };

/* =========================
   CLOUDFLARE STREAM
========================= */

$('createLiveInput').onclick =
  async () => {
    try {
      const d =
        await api(
          '/api/live/input',
          {
            method: 'POST',

            headers: {
              'content-type':
                'application/json'
            },

            body: JSON.stringify({
              name:
                $('liveName').value
            })
          }
        );

      if (!d.input) {
        throw new Error(
          'Cloudflare n’a pas retourné le Live Input.'
        );
      }

      $('liveCredentials').textContent =
        JSON.stringify(
          {
            uid: d.input.uid,
            rtmps: d.input.rtmps,
            srt: d.input.srt,
            webRTC: d.input.webRTC
          },
          null,
          2
        );

      showSuccess(
        'Live Input Cloudflare créé.'
      );

    } catch (e) {
      $('liveCredentials').textContent =
        'Erreur : ' + e.message;

      showError(e.message);
    }
  };

$('checkLive').onclick =
  async () => {
    try {
      const d =
        await api(
          '/api/live/status'
        );

      $('liveCredentials').textContent =
        JSON.stringify(
          d,
          null,
          2
        );

      if (!d.ok) {
        throw new Error(
          d.error ||
          'Aucun direct actif.'
        );
      }

      S.live = {
        enabled: true,
        hls: d.hls,
        videoId: d.videoId,
        inputId: d.inputId
      };

      render();

      playLive(d.hls);

      showSuccess(
        'Direct Cloudflare actif.'
      );

    } catch (e) {
      $('liveCredentials').textContent =
        'Erreur : ' + e.message;

      showError(e.message);
    }
  };

/* =========================
   LECTEUR LIVE
========================= */

function playLive(hls) {
  const v = $('liveVideo');

  if (!hls || !v) return;

  if (
    v.canPlayType(
      'application/vnd.apple.mpegurl'
    )
  ) {
    if (v.src !== hls) {
      v.src = hls;
    }

    v.play().catch(() => {});
  } else {
    $('liveHint').innerHTML =
      'DIRECT ACTIF<br><small>' +
      'Ce navigateur nécessite un lecteur HLS compatible' +
      '</small>';
  }
}

/* =========================
   SURVEILLANCE DU LIVE
========================= */

async function refreshLive() {
  try {
    const d =
      await api('/api/live/status');

    if (d.ok && d.hls) {
      playLive(d.hls);

      $('liveHint').style.display =
        'none';
    }
  } catch {
    /*
     * Pas d'alerte ici :
     * l'absence temporaire du live
     * ne doit pas afficher une erreur
     * toutes les 10 secondes.
     */
  }
}

/* =========================
   DÉMARRAGE FINAL
========================= */

boot();
