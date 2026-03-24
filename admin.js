import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  addDoc,
  collection,
  deleteField,
  deleteDoc,
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
const btnAddQuestion = document.getElementById('btn-add-question');
const questionTextInput = document.getElementById('question-text-input');
const tableBody = document.getElementById('players-table-body');
const questionsTableBody = document.getElementById('questions-table-body');

let currentUser = null;
let canManage = false;
let unsubscribePlayers = null;
let unsubscribeQuestions = null;

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
  btnAddQuestion.disabled = !enabled;
}

async function isCurrentUserAdmin(uid) {
  const adminSnap = await getDoc(doc(db, 'admins', uid));
  return adminSnap.exists();
}

function renderPlayersTable(players) {
  if (players.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="9">Nessun giocatore trovato.</td></tr>';
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
          <td>
            <div class="question-actions">
              <button class="mini-btn" data-action="save-player">Salva</button>
              <button class="mini-btn btn-danger" data-action="remove-player" ${isActive ? '' : 'disabled'}>Togli dal gioco</button>
            </div>
          </td>
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

function sortPlayersForTurn(players) {
  return players
    .slice()
    .sort((a, b) => {
      const orderA = Number(a.data.ordine_turno);
      const orderB = Number(b.data.ordine_turno);
      if (Number.isFinite(orderA) && Number.isFinite(orderB) && orderA !== orderB) {
        return orderA - orderB;
      }
      return String(a.data.nome || a.id).localeCompare(String(b.data.nome || b.id));
    });
}

async function removePlayerFromGame(playerId) {
  const ok = window.confirm(`Confermi che vuoi togliere ${playerId} dalla partita attiva?`);
  if (!ok) return;

  const playersSnap = await getDocs(collection(db, 'giocatori'));
  const players = playersSnap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
  const targetPlayer = players.find((player) => player.id === playerId);

  if (!targetPlayer) {
    setMessage('Giocatore non trovato.', true);
    return;
  }

  const activeOrdered = sortPlayersForTurn(
    players.filter((player) => player.id !== playerId && player.data.in_partita !== false)
  );

  const gameInfoRef = doc(db, 'stato_partita', 'info_generali');
  const gameInfoSnap = await getDoc(gameInfoRef);
  const currentTurnPlayerId = (gameInfoSnap.data() || {}).turno_attuale_id || null;

  const batch = writeBatch(db);

  batch.update(doc(db, 'giocatori', playerId), {
    in_partita: false,
    posizione: 1,
    domanda_corrente_id: deleteField(),
    domanda_corrente_testo: deleteField(),
    domanda_bonus_tipo: deleteField(),
    updated_at: serverTimestamp()
  });

  if (currentTurnPlayerId === playerId) {
    batch.set(gameInfoRef, {
      turno_attuale_id: activeOrdered.length > 0 ? activeOrdered[0].id : null,
      updated_at: serverTimestamp()
    }, { merge: true });
  }

  await batch.commit();
  setMessage(`Giocatore ${playerId} tolto dalla partita.`);
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
    totale_caselle: Number(gameInfo.totale_caselle) || 48,
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
  tableBody.innerHTML = '<tr><td colspan="9">Nessun dato disponibile.</td></tr>';
}

function renderQuestionsTable(questionDocs) {
  if (!questionsTableBody) return;

  if (questionDocs.length === 0) {
    questionsTableBody.innerHTML = '<tr><td colspan="4">Nessuna domanda presente.</td></tr>';
    return;
  }

  questionsTableBody.innerHTML = questionDocs
    .map((questionDoc) => {
      const data = questionDoc.data() || {};
      const text = escapeHtml(data.testo || '');
      const isActive = data.attiva !== false;

      return `
        <tr data-question-id="${questionDoc.id}">
          <td>${escapeHtml(questionDoc.id)}</td>
          <td>
            <textarea class="question-edit-input" data-field="testo">${text}</textarea>
          </td>
          <td>
            <input type="checkbox" data-field="attiva" ${isActive ? 'checked' : ''} />
          </td>
          <td>
            <div class="question-actions">
              <button class="mini-btn" data-action="save-question">Salva</button>
              <button class="mini-btn btn-danger" data-action="delete-question">Elimina</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function clearQuestionsTable() {
  if (!questionsTableBody) return;
  questionsTableBody.innerHTML = '<tr><td colspan="4">Nessun dato disponibile.</td></tr>';
}

function attachQuestionsListener() {
  if (unsubscribeQuestions) {
    unsubscribeQuestions();
    unsubscribeQuestions = null;
  }

  unsubscribeQuestions = onSnapshot(collection(db, 'domande'), (snapshot) => {
    const docs = snapshot.docs.slice().sort((a, b) => {
      const textA = String((a.data() || {}).testo || '');
      const textB = String((b.data() || {}).testo || '');
      return textA.localeCompare(textB);
    });
    renderQuestionsTable(docs);
  }, (error) => {
    console.error('Errore listener domande:', error);
    setMessage('Errore caricamento domande.', true);
  });
}

async function addQuestion() {
  const text = questionTextInput.value.trim();
  if (!text) {
    setMessage('Scrivi il testo della domanda.', true);
    return;
  }

  await addDoc(collection(db, 'domande'), {
    testo: text,
    attiva: true,
    created_at: serverTimestamp(),
    created_by: currentUser ? currentUser.uid : null
  });

  questionTextInput.value = '';
  setMessage('Domanda aggiunta.');
}

async function deleteQuestion(questionId) {
  const ok = window.confirm('Confermi eliminazione domanda?');
  if (!ok) return;

  await deleteDoc(doc(db, 'domande', questionId));
  setMessage('Domanda eliminata.');
}

async function saveQuestionFromRow(row) {
  const questionId = row.dataset.questionId;
  if (!questionId) return;

  const textInput = row.querySelector('textarea[data-field="testo"]');
  const activeInput = row.querySelector('input[data-field="attiva"]');

  if (!textInput || !activeInput) return;

  const text = textInput.value.trim();
  const isActive = activeInput.checked;

  if (!text) {
    setMessage('Il testo della domanda non puo essere vuoto.', true);
    return;
  }

  await updateDoc(doc(db, 'domande', questionId), {
    testo: text,
    attiva: isActive,
    updated_at: serverTimestamp(),
    updated_by: currentUser ? currentUser.uid : null
  });

  setMessage('Domanda aggiornata.');
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

  btnAddQuestion.addEventListener('click', async () => {
    try {
      await addQuestion();
    } catch (error) {
      console.error('Errore aggiunta domanda:', error);
      setMessage('Aggiunta domanda non riuscita. Verifica i permessi admin.', true);
    }
  });

  tableBody.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.dataset.action) return;

    const row = target.closest('tr');
    if (!row) return;

    target.setAttribute('disabled', 'true');
    try {
      if (target.dataset.action === 'save-player') {
        await savePlayerFromRow(row);
      } else if (target.dataset.action === 'remove-player') {
        await removePlayerFromGame(row.dataset.playerId || '');
      }
    } catch (error) {
      console.error('Errore aggiornamento giocatore:', error);
      setMessage('Aggiornamento non riuscito. Verifica i permessi admin.', true);
    } finally {
      target.removeAttribute('disabled');
    }
  });

  questionsTableBody.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.dataset.action) return;

    const row = target.closest('tr');
    if (!row) return;

    const questionId = row.dataset.questionId;
    if (!questionId) return;

    target.setAttribute('disabled', 'true');
    try {
      if (target.dataset.action === 'save-question') {
        await saveQuestionFromRow(row);
      } else if (target.dataset.action === 'delete-question') {
        await deleteQuestion(questionId);
      }
    } catch (error) {
      console.error('Errore operazione domanda:', error);
      setMessage('Operazione sulla domanda non riuscita.', true);
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
      clearQuestionsTable();
      setMessage('Accedi con un account admin.');
      if (unsubscribePlayers) {
        unsubscribePlayers();
        unsubscribePlayers = null;
      }
      if (unsubscribeQuestions) {
        unsubscribeQuestions();
        unsubscribeQuestions = null;
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
        clearQuestionsTable();
        setMessage('Non hai la benedizione di Nonna Papera.', true);
        if (unsubscribePlayers) {
          unsubscribePlayers();
          unsubscribePlayers = null;
        }
        if (unsubscribeQuestions) {
          unsubscribeQuestions();
          unsubscribeQuestions = null;
        }
        return;
      }

      adminRoleStatusEl.textContent = 'Admin attivo';
      setControlsEnabled(true);
      setMessage('Pannello pronto. Puoi modificare i giocatori e resettare la partita.');
      attachPlayersListener();
      attachQuestionsListener();
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
