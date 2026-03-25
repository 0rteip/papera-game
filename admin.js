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
const btnExportReportPdf = document.getElementById('btn-export-report-pdf');
const btnCleanOldAnswers = document.getElementById('btn-clean-old-answers');
const btnAddQuestion = document.getElementById('btn-add-question');
const questionTextInput = document.getElementById('question-text-input');
const tableBody = document.getElementById('players-table-body');
const questionsTableBody = document.getElementById('questions-table-body');
const adminRealContentEl = document.getElementById('admin-real-content');
const nonAdminCoverEl = document.getElementById('non-admin-cover');

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
  if (btnExportReportPdf) {
    btnExportReportPdf.disabled = !enabled;
  }
  if (btnCleanOldAnswers) {
    btnCleanOldAnswers.disabled = !enabled;
  }
  btnAddQuestion.disabled = !enabled;
}

function getTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildGameId() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `partita-${stamp}`;
}

function formatFirestoreDate(value) {
  if (!value) return '-';

  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date.toLocaleString('it-IT');
  }

  if (value instanceof Date) {
    return value.toLocaleString('it-IT');
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString('it-IT');
  }

  return '-';
}

function getReportTimestampValue(entry) {
  const primary = entry.timestamp;
  const fallback = entry.data_risposta;
  const candidate = primary || fallback;

  if (!candidate) return 0;
  if (typeof candidate.toMillis === 'function') return candidate.toMillis();
  if (candidate instanceof Date) return candidate.getTime();

  const parsed = new Date(candidate).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function ensurePdfRoom(pdf, y, minNeeded, pageHeight, marginY) {
  if (y + minNeeded <= pageHeight - marginY) {
    return y;
  }

  pdf.addPage();
  return marginY;
}

async function exportQuestionsReportPdf() {
  if (!canManage) {
    setMessage('Solo admin puo esportare il report.', true);
    return;
  }

  const jsPdfNs = window.jspdf;
  if (!jsPdfNs || !jsPdfNs.jsPDF) {
    setMessage('Libreria PDF non disponibile. Ricarica la pagina.', true);
    return;
  }

  const reportSnap = await getDocs(collection(db, 'risposte_date'));
  const reportRows = reportSnap.docs
    .map((docSnap) => {
      const data = docSnap.data() || {};
      return {
        id: docSnap.id,
        id_domanda: data.id_domanda || '-',
        testo_domanda: data.testo_domanda || '',
        testo_risposta: data.testo_risposta || '',
        nome_giocatore: data.nome_giocatore || data.id_giocatore || '-',
        timestamp: data.timestamp || data.data_risposta || null,
        data_risposta: data.data_risposta || null
      };
    })
    .sort((a, b) => getReportTimestampValue(a) - getReportTimestampValue(b));

  if (reportRows.length === 0) {
    setMessage('Nessuna risposta trovata in risposte_date.', true);
    return;
  }

  const { jsPDF } = jsPdfNs;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 42;
  const marginY = 44;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - marginX * 2;
  let y = marginY;

  const groupedByQuestion = [];
  const groupsByKey = new Map();

  reportRows.forEach((row, index) => {
    const questionId = String(row.id_domanda || '-');
    const questionText = String(row.testo_domanda || '').trim();
    const key = questionId !== '-' ? questionId : `no-id-${index}-${questionText}`;

    if (!groupsByKey.has(key)) {
      const group = {
        id_domanda: questionId,
        testo_domanda: questionText || 'Domanda senza testo',
        risposte: []
      };
      groupsByKey.set(key, group);
      groupedByQuestion.push(group);
    }

    groupsByKey.get(key).risposte.push({
      nome_giocatore: row.nome_giocatore || '-',
      testo_risposta: row.testo_risposta || '-',
      timestamp: row.timestamp || row.data_risposta || null
    });
  });

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text('Report Domande Partita', marginX, y);
  y += 22;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text(`Generato il: ${new Date().toLocaleString('it-IT')}`, marginX, y);
  y += 14;
  pdf.text(`Totale domande: ${groupedByQuestion.length}`, marginX, y);
  y += 14;
  pdf.text(`Totale risposte: ${reportRows.length}`, marginX, y);
  y += 18;

  groupedByQuestion.forEach((group, index) => {
    y = ensurePdfRoom(pdf, y, 96, pageHeight, marginY);

    pdf.setDrawColor(220, 220, 220);
    pdf.line(marginX, y - 8, pageWidth - marginX, y - 8);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    const headingText = group.id_domanda && group.id_domanda !== '-'
      ? `Domanda ${index + 1} (${group.id_domanda})`
      : `Domanda ${index + 1}`;
    pdf.text(headingText, marginX, y + 10);

    const questionLines = pdf.splitTextToSize(group.testo_domanda, contentWidth);
    y += 30;
    y = ensurePdfRoom(pdf, y, questionLines.length * 11 + 16, pageHeight, marginY);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text(questionLines, marginX, y);
    y += questionLines.length * 11 + 8;

    group.risposte.forEach((item) => {
      const dateLabel = formatFirestoreDate(item.timestamp);
      const answerLine = `${item.nome_giocatore}: ${item.testo_risposta} (${dateLabel})`;
      const answerLines = pdf.splitTextToSize(answerLine, contentWidth - 10);

      y = ensurePdfRoom(pdf, y, answerLines.length * 11 + 8, pageHeight, marginY);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.text(answerLines, marginX + 10, y);
      y += answerLines.length * 11 + 4;
    });

    y += 8;
  });

  const filenameDate = new Date().toISOString().slice(0, 10);
  pdf.save(`report-domande-${filenameDate}.pdf`);
  setMessage('Report PDF generato con successo.');
}

function setAdminPanelVisibility(isAdmin) {
  if (adminRealContentEl) {
    adminRealContentEl.classList.toggle('hidden', !isAdmin);
  }

  if (nonAdminCoverEl) {
    nonAdminCoverEl.classList.toggle('hidden', isAdmin);
  }
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
  const nextGameId = buildGameId();

  batch.set(gameInfoRef, {
    totale_caselle: Number(gameInfo.totale_caselle) || 48,
    partita_id: nextGameId,
    turno_attuale_id: nextTurnId,
    updated_at: serverTimestamp()
  }, { merge: true });

  await batch.commit();
  setMessage(`Partita resettata con successo. ID: ${nextGameId}`);
}

async function cleanOldAnswers() {
  const input = window.prompt('Cancella risposte piu vecchie di quanti giorni? (es. 30)\nUsa 0 per cancellare tutte.', '30');
  if (input === null) return;

  const days = Number(input);
  if (!Number.isFinite(days) || days < 0) {
    setMessage('Valore non valido. Inserisci un numero >= 0.', true);
    return;
  }

  const confirmText = days === 0
    ? 'Confermi la cancellazione di TUTTE le risposte salvate?'
    : `Confermi la cancellazione delle risposte vecchie piu di ${days} giorni?`;

  const ok = window.confirm(confirmText);
  if (!ok) return;

  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const answersSnap = await getDocs(collection(db, 'risposte_date'));

  const toDeleteRefs = answersSnap.docs
    .filter((docSnap) => {
      if (days === 0) return true;
      const data = docSnap.data() || {};
      const ts = getTimestampMillis(data.timestamp || data.data_risposta);
      return ts > 0 && ts < cutoff;
    })
    .map((docSnap) => doc(db, 'risposte_date', docSnap.id));

  if (toDeleteRefs.length === 0) {
    setMessage('Nessuna risposta vecchia da cancellare.');
    return;
  }

  const chunkSize = 400;
  for (let i = 0; i < toDeleteRefs.length; i += chunkSize) {
    const chunk = toDeleteRefs.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  setMessage(`Cancellate ${toDeleteRefs.length} risposte.`);
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

  if (btnExportReportPdf) {
    btnExportReportPdf.addEventListener('click', async () => {
      try {
        btnExportReportPdf.disabled = true;
        await exportQuestionsReportPdf();
      } catch (error) {
        console.error('Errore export PDF:', error);
        setMessage('Export PDF non riuscito.', true);
      } finally {
        btnExportReportPdf.disabled = !canManage;
      }
    });
  }

  if (btnCleanOldAnswers) {
    btnCleanOldAnswers.addEventListener('click', async () => {
      try {
        btnCleanOldAnswers.disabled = true;
        await cleanOldAnswers();
      } catch (error) {
        console.error('Errore pulizia risposte vecchie:', error);
        setMessage('Pulizia risposte non riuscita.', true);
      } finally {
        btnCleanOldAnswers.disabled = !canManage;
      }
    });
  }

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
      canManage = false;
      adminAuthUserEl.textContent = 'Non autenticato';
      adminRoleStatusEl.textContent = 'Accesso negato';
      btnLogin.classList.remove('hidden');
      btnLogout.classList.add('hidden');
      setAdminPanelVisibility(false);
      setControlsEnabled(false);
      clearPlayersTable();
      clearQuestionsTable();
      setMessage('Nonna Papera sta scegliendo chi puo entrare nella dispensa...');
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
        adminRoleStatusEl.textContent = 'Papero semplice';
        setAdminPanelVisibility(false);
        setControlsEnabled(false);
        clearPlayersTable();
        clearQuestionsTable();
        setMessage('Torna domani per una nuova ricetta.', true);
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
      setAdminPanelVisibility(true);
      setControlsEnabled(true);
      setMessage('Pannello pronto. Puoi modificare i giocatori e resettare la partita.');
      attachPlayersListener();
      attachQuestionsListener();
    } catch (error) {
      console.error('Errore verifica ruolo admin:', error);
      setAdminPanelVisibility(false);
      adminRoleStatusEl.textContent = 'Errore verifica ruolo';
      setControlsEnabled(false);
      clearPlayersTable();
      setMessage('Errore durante la verifica admin.', true);
    }
  });
}

wireEvents();
attachAuthListener();
