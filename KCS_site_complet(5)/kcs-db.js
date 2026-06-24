/* ============================================================
   KCS-DB.JS — Authentification équipe + Stockage Supabase partagé
   Inclure ce script dans TOUTES les pages (accueil + bilans + suivi)
   <script src="kcs-db.js"></script>
   ============================================================ */

(function(){
  "use strict";

  // ── Config Supabase ──────────────────────────────────────────
  var SUPA_URL = 'https://gstiswxvuhmomckhviby.supabase.co';
  var SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzdGlzd3h2dWhtb21ja2h2aWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MDEzMzksImV4cCI6MjA5NzQ3NzMzOX0.RUIlIiWWIJ9Z0kW7kQc9PD77bQRWzlEiBmWO2lIlQ3s';
  var REST_URL = SUPA_URL + '/rest/v1/bilans';

  // ── Mot de passe équipe (hash SHA-256, jamais stocké en clair) ──
  var TEAM_PASSWORD_HASH = '0e4b117e217ac8872e1b420b62c106176d89b2be3cf97c5512fe36f52bd987a0';
  var SESSION_KEY = 'kcs_session_ok';
  var SESSION_TS_KEY = 'kcs_session_ts';
  var SESSION_DURATION_MS = 60 * 60 * 1000; // 1 heure

  function isSessionValid(){
    try {
      if (sessionStorage.getItem(SESSION_KEY) !== '1') return false;
      var ts = parseInt(sessionStorage.getItem(SESSION_TS_KEY) || '0', 10);
      if (!ts) return false;
      if (Date.now() - ts > SESSION_DURATION_MS) return false;
      return true;
    } catch(e){ return false; }
  }

  function refreshSessionTs(){
    try { sessionStorage.setItem(SESSION_TS_KEY, String(Date.now())); } catch(e){}
  }

  async function sha256(text){
    var enc = new TextEncoder().encode(text);
    var buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
  }

  // ── GATE : vérifie le mot de passe avant d'afficher la page ──
  window.KCS_checkAuth = function(){
    return new Promise(function(resolve){
      try {
        if (isSessionValid()) {
          refreshSessionTs();
          setupActivityTracking();
          resolve(true);
          return;
        }
      } catch(e){}

      var overlay = document.createElement('div');
      overlay.id = 'kcs-auth-gate';
      overlay.style.cssText = 'position:fixed;inset:0;background:#0f1117;z-index:99999;display:flex;align-items:center;justify-content:center;font-family:-apple-system,system-ui,sans-serif;';
      overlay.innerHTML =
        '<div style="background:#1e2030;border:1px solid #3d4270;border-radius:18px;padding:32px 28px;max-width:340px;width:90%;text-align:center;">' +
          '<div style="font-size:15px;font-weight:700;color:#e8eaf6;margin-bottom:6px;">Kinesport Croix-Sainte</div>' +
          '<div style="font-size:12px;color:#9fa8da;margin-bottom:20px;">Accès réservé à l\'équipe</div>' +
          '<input id="kcs-pwd-input" type="password" placeholder="Mot de passe équipe" autocomplete="off" style="width:100%;padding:11px 14px;border-radius:10px;border:1px solid #3d4270;background:#252840;color:#e8eaf6;font-size:14px;outline:none;box-sizing:border-box;margin-bottom:12px;font-family:inherit;">' +
          '<button id="kcs-pwd-btn" style="width:100%;padding:11px;border-radius:10px;border:none;background:#6c63ff;color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;">Accéder</button>' +
          '<div id="kcs-pwd-err" style="color:#ff5252;font-size:12px;margin-top:10px;display:none;">Mot de passe incorrect</div>' +
        '</div>';
      document.body.appendChild(overlay);

      var input = document.getElementById('kcs-pwd-input');
      var btn = document.getElementById('kcs-pwd-btn');
      var err = document.getElementById('kcs-pwd-err');
      input.focus();

      async function tryLogin(){
        var val = input.value || '';
        var h = await sha256(val);
        if (h === TEAM_PASSWORD_HASH) {
          try {
            sessionStorage.setItem(SESSION_KEY, '1');
            refreshSessionTs();
          } catch(e){}
          overlay.remove();
          setupActivityTracking();
          resolve(true);
        } else {
          err.style.display = 'block';
          input.value = '';
          input.focus();
        }
      }
      btn.onclick = tryLogin;
      input.addEventListener('keydown', function(e){ if (e.key === 'Enter') tryLogin(); });
    });
  };

  // Rafraîchit le timestamp de session à chaque interaction utilisateur,
  // et redemande le mot de passe si la session expire pendant l'utilisation
  var _activityTrackingSetup = false;
  function setupActivityTracking(){
    if (_activityTrackingSetup) return;
    _activityTrackingSetup = true;
    var events = ['click', 'keydown', 'touchstart', 'scroll'];
    var throttled = false;
    function onActivity(){
      if (throttled) return;
      throttled = true;
      setTimeout(function(){ throttled = false; }, 5000); // max 1 refresh / 5s
      if (isSessionValid()) {
        refreshSessionTs();
      } else {
        // Session expirée pendant l'utilisation : redemander le mot de passe
        try { sessionStorage.removeItem(SESSION_KEY); } catch(e){}
        window.KCS_checkAuth();
      }
    }
    events.forEach(function(ev){ document.addEventListener(ev, onActivity, {passive:true}); });
  }

  var REST_URL_REEVAL = SUPA_URL + '/rest/v1/reevaluations';

  // Crée une nouvelle réévaluation
  window.KCS_createReeval = async function(bilanId, type, nomPatient, prenomPatient, data){
    try {
      var res = await fetch(REST_URL_REEVAL, {
        method: 'POST',
        headers: headers({'Prefer': 'return=representation'}),
        body: JSON.stringify({
          bilan_id: bilanId,
          type: type,
          nom_patient: nomPatient || '',
          prenom_patient: prenomPatient || '',
          date_reeval: new Date().toISOString().split('T')[0],
          eva: data.eva || {},
          scores: data.scores || {},
          amplitudes: data.amplitudes || {},
          force_musc: data.force_musc || {},
          rts_items: data.rts_items || [],
          rts_score: data.rts_score || 0,
          notes: data.notes || ''
        })
      });
      if (!res.ok) { console.error('KCS_createReeval', res.status, await res.text()); return null; }
      var json = await res.json();
      return json && json[0] ? json[0].id : null;
    } catch(e){ console.error('KCS_createReeval error', e); return null; }
  };

  // Sauvegarde une réévaluation existante
  window.KCS_saveReeval = async function(id, data){
    try {
      await fetch(REST_URL_REEVAL + '?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: headers({'Prefer': 'return=minimal'}),
        body: JSON.stringify(data)
      });
      return true;
    } catch(e){ console.error('KCS_saveReeval error', e); return false; }
  };

  // Liste toutes les réévaluations d'un bilan
  window.KCS_listReevals = async function(bilanId){
    try {
      var res = await fetch(REST_URL_REEVAL + '?bilan_id=eq.' + encodeURIComponent(bilanId) + '&order=date_reeval.asc&select=*', { headers: headers() });
      return await res.json();
    } catch(e){ console.error('KCS_listReevals error', e); return []; }
  };

  // Supprime une réévaluation
  window.KCS_deleteReeval = async function(id){
    try {
      await fetch(REST_URL_REEVAL + '?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: headers() });
      return true;
    } catch(e){ return false; }
  };



  // Charge les sessions de suivi pour une clé patient donnée
  window.KCS_loadSuivi = async function(patientKey){
    try {
      var res = await fetch(REST_URL_SUIVI + '?patient_key=eq.' + encodeURIComponent(patientKey) + '&select=*', { headers: headers() });
      var json = await res.json();
      return (json && json[0]) ? json[0].data : [];
    } catch(e){ console.error('KCS_loadSuivi error', e); return []; }
  };

  // Sauvegarde (upsert) les sessions de suivi pour une clé patient
  window.KCS_saveSuivi = async function(patientKey, type, nomPatient, sessionsArray){
    try {
      await fetch(REST_URL_SUIVI, {
        method: 'POST',
        headers: headers({'Prefer': 'resolution=merge-duplicates,return=minimal'}),
        body: JSON.stringify({
          patient_key: patientKey,
          type: type,
          nom_patient: nomPatient || '',
          data: sessionsArray,
          updated_at: new Date().toISOString()
        })
      });
      return true;
    } catch(e){ console.error('KCS_saveSuivi error', e); return false; }
  };

  // ── Helpers REST Supabase (fetch direct, pas de SDK requis) ──
  function headers(extra){
    var h = {
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json'
    };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }

  // Crée un nouveau bilan (brouillon) et retourne son id
  window.KCS_createBilan = async function(type, nomPatient, prenomPatient, cote){
    try {
      var res = await fetch(REST_URL, {
        method: 'POST',
        headers: headers({'Prefer': 'return=representation'}),
        body: JSON.stringify({
          type: type,
          nom_patient: nomPatient || '',
          prenom_patient: prenomPatient || '',
          cote: cote || '',
          data: {},
          is_draft: true
        })
      });
      if (!res.ok) {
        var errText = await res.text();
        console.error('KCS_createBilan HTTP ' + res.status + ': ' + errText);
        return null;
      }
      var json = await res.json();
      return json && json[0] ? json[0].id : null;
    } catch(e){ console.error('KCS_createBilan error', e); return null; }
  };

  // Sauvegarde (upsert) les données d'un bilan en cours
  window.KCS_saveBilan = async function(id, formData, opts){
    opts = opts || {};
    try {
      var body = { data: formData, updated_at: new Date().toISOString() };
      if (opts.nomPatient !== undefined) body.nom_patient = opts.nomPatient;
      if (opts.prenomPatient !== undefined) body.prenom_patient = opts.prenomPatient;
      if (opts.cote !== undefined) body.cote = opts.cote;
      if (opts.isDraft !== undefined) body.is_draft = opts.isDraft;

      await fetch(REST_URL + '?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: headers({'Prefer': 'return=minimal'}),
        body: JSON.stringify(body)
      });
      return true;
    } catch(e){ console.error('KCS_saveBilan error', e); return false; }
  };

  var REST_URL_REEVAL = SUPA_URL + '/rest/v1/reevaluations';

  window.KCS_createReeval = async function(bilanId, type, nom, prenom, data){
    try {
      var res = await fetch(REST_URL_REEVAL, {
        method: 'POST',
        headers: headers({'Prefer': 'return=representation'}),
        body: JSON.stringify({
          bilan_id: bilanId, type: type,
          nom_patient: nom||'', prenom_patient: prenom||'',
          date_reeval: new Date().toISOString().split('T')[0],
          eva: data.eva||{}, scores: data.scores||{},
          amplitudes: data.amplitudes||{}, force_musc: data.force_musc||{},
          rts_items: data.rts_items||{}, rts_score: data.rts_score||0,
          notes: data.notes||''
        })
      });
      var json = await res.json();
      return json && json[0] ? json[0].id : null;
    } catch(e){ console.error('KCS_createReeval error', e); return null; }
  };

  window.KCS_saveReeval = async function(id, data){
    try {
      await fetch(REST_URL_REEVAL + '?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH', headers: headers({'Prefer': 'return=minimal'}),
        body: JSON.stringify(data)
      });
      return true;
    } catch(e){ console.error('KCS_saveReeval error', e); return false; }
  };

  window.KCS_listReevals = async function(bilanId){
    try {
      var res = await fetch(REST_URL_REEVAL + '?bilan_id=eq.' + encodeURIComponent(bilanId) + '&order=date_reeval.asc&select=*', { headers: headers() });
      return await res.json();
    } catch(e){ console.error('KCS_listReevals error', e); return []; }
  };

  window.KCS_deleteReeval = async function(id){
    try {
      await fetch(REST_URL_REEVAL + '?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: headers() });
      return true;
    } catch(e){ console.error('KCS_deleteReeval error', e); return false; }
  };

  // Indique si le bilan courant est terminé (is_draft: false)
  window.KCS_bilanIsFinished = false;

  // Charge un bilan par id
  window.KCS_loadBilan = async function(id){
    try {
      var res = await fetch(REST_URL + '?id=eq.' + encodeURIComponent(id) + '&select=*', { headers: headers() });
      var json = await res.json();
      return json && json[0] ? json[0] : null;
    } catch(e){ console.error('KCS_loadBilan error', e); return null; }
  };

  // Liste l'historique (tous bilans, triés par date desc), avec filtre optionnel par type
  window.KCS_listBilans = async function(type, limit){
    try {
      var url = REST_URL + '?select=id,type,nom_patient,prenom_patient,cote,is_draft,created_at,updated_at&order=updated_at.desc&limit=' + (limit || 50);
      if (type) url += '&type=eq.' + encodeURIComponent(type);
      var res = await fetch(url, { headers: headers() });
      return await res.json();
    } catch(e){ console.error('KCS_listBilans error', e); return []; }
  };

  // Supprime un bilan
  window.KCS_deleteBilan = async function(id){
    try {
      await fetch(REST_URL + '?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: headers() });
      return true;
    } catch(e){ console.error('KCS_deleteBilan error', e); return false; }
  };

  // ── Auto-save générique : récupère tous les inputs/textareas/selects d'une page ──
  // et les sauvegarde périodiquement. Retourne un objet {start, stop, getData, setData}
  window.KCS_autoSave = function(bilanIdGetter, opts){
    opts = opts || {};
    var intervalMs = opts.interval || 8000;
    var timer = null;
    var statusEl = opts.statusElId ? document.getElementById(opts.statusElId) : null;

    function collectFormData(){
      var data = {};
      document.querySelectorAll('input[id], textarea[id], select[id]').forEach(function(el){
        if (el.type === 'file') return;
        if (el.type === 'checkbox') { data[el.id] = el.checked; }
        else { data[el.id] = el.value; }
      });
      return data;
    }

    function applyFormData(data){
      if (!data) return;
      Object.keys(data).forEach(function(id){
        var el = document.getElementById(id);
        if (!el) return;
        if (el.type === 'checkbox') { el.checked = !!data[id]; }
        else { el.value = data[id]; }
        // Trigger input/change so any onchange/oninput logic recalculates
        el.dispatchEvent(new Event('input', {bubbles:true}));
        el.dispatchEvent(new Event('change', {bubbles:true}));
      });
    }

    async function doSave(){
      var id = bilanIdGetter();
      if (!id) return;
      var data = collectFormData();
      if (statusEl) { statusEl.textContent = 'Enregistrement…'; statusEl.style.opacity = '0.6'; }
      var ok = await window.KCS_saveBilan(id, data, {
        nomPatient: document.getElementById('nom') ? document.getElementById('nom').value : undefined,
        prenomPatient: document.getElementById('prenom') ? document.getElementById('prenom').value : undefined,
        cote: document.getElementById('cote') ? document.getElementById('cote').value : undefined
      });
      if (statusEl) { statusEl.textContent = ok ? 'Enregistré ✓' : 'Erreur de sauvegarde'; statusEl.style.opacity = '1'; }
    }

    return {
      start: function(){ if (timer) return; timer = setInterval(doSave, intervalMs); window.addEventListener('beforeunload', doSave); },
      stop: function(){ if (timer) clearInterval(timer); timer = null; },
      saveNow: doSave,
      collectFormData: collectFormData,
      applyFormData: applyFormData
    };
  };


  // ── AUTO-IMPORT depuis paramètre URL kcs1= ──────────────────────────────
  // Appelé dans chaque bilan après le gate d'auth
  window.KCS_autoImport = function(importFnName){
    try {
      var params = new URLSearchParams(window.location.search);
      var payload = params.get('kcs1');
      if (!payload) return;
      var b64 = payload.replace(/-/g,'+').replace(/_/g,'/');
      // Padding base64 si nécessaire
      while (b64.length % 4) b64 += '=';
      var data = JSON.parse(decodeURIComponent(escape(atob(b64))));
      // Nettoyer l'URL immédiatement pour éviter les conflits
      var cleanUrl = window.location.pathname + (window.location.search.replace(/[?&]kcs1=[^&]*/g, '') || '');
      window.history.replaceState({}, '', cleanUrl);
      // Attendre que le DOM soit prêt avant de remplir
      setTimeout(function(){
        var set = function(id, v){ var el=document.getElementById(id); if(el && v !== undefined && v !== '') el.value=v; };
        set('nom', data.nom);
        set('prenom', data.prenom);
        set('ddn', data.ddn);
        set('sport', data.sport);
        set('metier', data.metier);
        set('cote', data.cote);
        set('anciennete', data.anciennete);
        // EVA sliders
        if (data.eva) {
          Object.keys(data.eva).forEach(function(k){
            var s = document.getElementById(k);
            if (s) {
              s.value = data.eva[k];
              if (typeof setEva === 'function') setEva(k, data.eva[k]);
              else { var vEl = document.getElementById(k+'-val'); if(vEl) vEl.textContent = data.eva[k]; }
            }
          });
        }
        // Champs spécifiques (tendon, region)
        set('tendon-type', data.tendon);
        set('region', data.region);
        // Appeler la fonction d'import spécifique au bilan si elle existe
        if (importFnName && typeof window[importFnName] === 'function') {
          window[importFnName](data);
        }
        // Afficher un message de succès
        var nom = ((data.prenom||'') + ' ' + (data.nom||'')).trim();
        var statusEl = document.getElementById('kcs-save-status');
        if (statusEl) { statusEl.textContent = nom ? '✓ Patient importé : ' + nom : '✓ Données importées'; statusEl.style.display='block'; }
      }, 300);
    } catch(e) { console.error('KCS_autoImport error', e); }
  };

})();
