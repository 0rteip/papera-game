import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDhRoifzgbUBCQcSgyzAh8fkmtdFtsol-A',
  authDomain: 'papera-game.firebaseapp.com',
  projectId: 'papera-game',
  storageBucket: 'papera-game.firebasestorage.app',
  messagingSenderId: '949145087126',
  appId: '1:949145087126:web:126563d4f19ba2746f66b7'
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const authProvider = new GoogleAuthProvider();

const adminAuthUserEl = document.getElementById('admin-auth-user');
const adminRoleStatusEl = document.getElementById('admin-role-status');
const adminMessageEl = document.getElementById('admin-message');
const btnLogin = document.getElementById('admin-btn-login');
const btnLogout = document.getElementById('admin-btn-logout');
const btnRefreshPlayers = document.getElementById('btn-refresh-players');
const btnResetGame = document.getElementById('btn-reset-game');
const tableBody = document.getElementById('players-table-body');

let currentUser = null;
let canManage = false;
let unsubscribePlayers = null;

function setMessage(message, isError = false) {
  adminMessageEl.textContent = message;
  adminMessageEl.style.color = isError ? '#c0392b' : '#333333';
}

function escapeHtml(raw) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setControlsEnabled(enabled) {
  btnRefreshPlayers.disabled = !enabled;
  btnResetGame.disabled = !enabled;
}

async function isCurrentUserAdmin(uid) {
  const adminSnap = await getDoc(doc(db, 'admins', uid));
  return adminSnap.exists();
}

function renderPlayersTable(players) {
  if (players.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="8">Nessun giocatore trovato.</td></tr>';
    return;
  }

  const rowsHtml = players
    .sort((a, b) => {
      const orderA = Number(a.data.ordine_turno);
      const orderB = Number(b.data.ordine_turno);
      if (Number.isFinite(orderA) && Number.isFinite(orderB) && orderA !== orderB) {
        return orderA - orderB;
      }
      return String(a.data.nome || a.id).localeCompare(String(b.data.nome || b.id));
    })
    .map((player) => {
      const p = player.data;
      const safeName = escapeHtml(p.nome || '');
      const safeEmail = escapeHtml(p.email || '');
      const color = p.colore || '#666666';
      const order = Number.isFinite(Number(p.ordine_turno)) ? Number(p.ordine_turno) : '';
      const position = Number.isFinite(Number(p.posizione)) ? Number(p.posizione) : 1;
      const isActive = p.in_partita !== false;

      return `
        <tr data-player-id="${player.id}">
          <td>${escapeHtml(player.id)}</td>
          <td><input type="text" data-field="nome" value="${safeName}" /></td>
          <td>${safeEmail || '-'}</td>
          <td><input type="color" data-field="colore" value="${color}" /></td>
          <td><input type="number" data-field="ordine_turno" min="1" value="${order}" /></td>
          <td><input type="checkbox" data-field="in_partita" ${isActive ? 'checked' : ''} /></td>
          <td><input type="number" data-field="posizione" min="1" value="${position}" /></td>
          <td><button class="mini-btn" data-action="save-player">Salva</button></td>
        </tr>
      `;
    })
    .join('');

  tableBody.innerHTML = rowsHtml;
}

async function savePlayerFromRow(row) {
  const playerId = row.dataset.playerId;
  if (!playerId) return;

  const nome = row.querySelector('input[data-field="nome"]').value.trim();
  const colore = row.querySelector('input[data-field="colore"]').value || '#666666';
  const ordineTurnoRaw = row.querySelector('input[data-field="ordine_turno"]').value;
  const posizioneRaw = row.querySelector('input[data-field="posizione"]').value;
  const inPartita = row.querySelector('input[data-field="in_partita"]').checked;

  const ordineTurno = Number(ordineTurnoRaw);
  const posizione = Math.max(1, Number(posizioneRaw) || 1);

  const payload = {
    nome: nome || 'Giocatore',
    colore,
    posizione,
    in_partita: inPartita,
    updated_at: serverTimestamp()
  };

  if (Number.isFinite(ordineTurno) && ordineTurno > 0) {
    payload.ordine_turno = ordineTurno;
  }

  await updateDoc(doc(db, 'giocatori', playerId), payload);
  setMessage(`Giocatore ${playerId} aggiornato.`);
}

async function resetGame() {
  const ok = window.confirm('Confermi il reset partita? Posizioni e domande_risposte saranno azzerate.');
  if (!ok) return;

  const playersSnap = await getDocs(collection(db, 'giocatori'));
  const players = playersSnap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));

  const batch = writeBatch(db);

  players.forEach((player) => {
    batch.update(doc(db, 'giocatori', player.id), {
      posizione: 1,
      domande_risposte: [],
      updated_at: serverTimestamp()
    });
  });

  const activeOrdered = players
    .filter((p) => p.data.in_partita !== false)
    .sort((a, b) => {
      const orderA = Number(a.data.ordine_turno);
      const orderB = Number(b.data.ordine_turno);
      if (Number.isFinite(orderA) && Number.isFinite(orderB) && orderA !== orderB) {
        return orderA - orderB;
      }
      return String(a.data.nome || a.id).localeCompare(String(b.data.nome || b.id));
    });

  const gameInfoRef = doc(db, 'stato_partita', 'info_generali');
  const gameInfoSnap = await getDoc(gameInfoRef);
  const gameInfo = gameInfoSnap.data() || {};
  const nextTurnId = activeOrdered.length > 0 ? activeOrdered[0].id : null;

  batch.set(gameInfoRef, {
    totale_caselle: Number(gameInfo.totale_caselle) || 60,
    turno_attuale_id: nextTurnId,
    updated_at: serverTimestamp()
  }, { merge: true });

  await batch.commit();
  setMessage('Partita resettata con successo.');
}

function attachPlayersListener() {
  if (unsubscribePlayers) {
    unsubscribePlayers();
    unsubscribePlayers = null;
  }

  unsubscribePlayers = onSnapshot(collection(db, 'giocatori'), (snapshot) => {
    const players = snapshot.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
    renderPlayersTable(players);
  }, (error) => {
    console.error('Errore listener admin giocatori:', error);
    setMessage('Errore caricamento giocatori.', true);
  });
}

function clearPlayersTable() {
  tableBody.innerHTML = '<tr><td colspan="8">Nessun dato disponibile.</td></tr>';
}

function wireEvents() {
  btnLogin.addEventListener('click', async () => {
    try {
      await signInWithPopup(auth, authProvider);
    } catch (error) {
      console.error('Errore login admin:', error);
      setMessage('Login non riuscito.', true);
    }
  });

  btnLogout.addEventListener('click', async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Errore logout admin:', error);
      setMessage('Logout non riuscito.', true);
    }
  });

  btnRefreshPlayers.addEventListener('click', async () => {
    try {
      const snap = await getDocs(collection(db, 'giocatori'));
      const players = snap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
      renderPlayersTable(players);
      setMessage('Lista aggiornata.');
    } catch (error) {
      console.error('Errore refresh giocatori:', error);
      setMessage('Refresh non riuscito.', true);
    }
  });

  btnResetGame.addEventListener('click', async () => {
    try {
      await resetGame();
    } catch (error) {
      console.error('Errore reset partita:', error);
      setMessage('Reset non riuscito. Controlla i permessi admin.', true);
    }
  });

  tableBody.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.action !== 'save-player') return;

    const row = target.closest('tr');
    if (!row) return;

    target.setAttribute('disabled', 'true');
    try {
      await savePlayerFromRow(row);
    } catch (error) {
      console.error('Errore aggiornamento giocatore:', error);
      setMessage('Aggiornamento non riuscito. Verifica i permessi admin.', true);
    } finally {
      target.removeAttribute('disabled');
    }
  });
}

function attachAuthListener() {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;

    if (!user) {
      adminAuthUserEl.textContent = 'Non autenticato';
      adminRoleStatusEl.textContent = 'Accesso negato';
      btnLogin.classList.remove('hidden');
      btnLogout.classList.add('hidden');
      setControlsEnabled(false);
      clearPlayersTable();
      setMessage('Accedi con un account admin.');
      if (unsubscribePlayers) {
        unsubscribePlayers();
        unsubscribePlayers = null;
      }
      return;
    }

    adminAuthUserEl.textContent = user.displayName || user.email || user.uid;
    btnLogin.classList.add('hidden');
    btnLogout.classList.remove('hidden');

    try {
      canManage = await isCurrentUserAdmin(user.uid);
      if (!canManage) {
        adminRoleStatusEl.textContent = 'Utente non admin';
        setControlsEnabled(false);
        clearPlayersTable();
        setMessage('Questo account non ha privilegi admin. Crea il doc admins/{uid} su Firestore.', true);
        if (unsubscribePlayers) {
          unsubscribePlayers();
          unsubscribePlayers = null;
        }
        return;
      }

      adminRoleStatusEl.textContent = 'Admin attivo';
      setControlsEnabled(true);
      setMessage('Pannello pronto. Puoi modificare i giocatori e resettare la partita.');
      attachPlayersListener();
    } catch (error) {
      console.error('Errore verifica ruolo admin:', error);
      adminRoleStatusEl.textContent = 'Errore verifica ruolo';
      setControlsEnabled(false);
      clearPlayersTable();
      setMessage('Errore durante la verifica admin.', true);
    }
  });
}

wireEvents();
attachAuthListener();
