import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

document.addEventListener('DOMContentLoaded', () => {
  const boardContainer = document.getElementById('board');
  const playersLegendListEl = document.getElementById('players-legend-list');
  const btnRoll = document.getElementById('btn-roll-dice');
  const currentPlayerNameEl = document.getElementById('current-player-name');
  const authUserNameEl = document.getElementById('auth-user-name');
  const btnLoginGoogle = document.getElementById('btn-login-google');
  const btnLogout = document.getElementById('btn-logout');
  const questionModal = document.getElementById('question-modal');
  const questionTextEl = document.getElementById('question-text');
  const answerInputEl = document.getElementById('answer-input');
  const btnSubmitAnswer = document.getElementById('btn-submit-answer');

  
  const firebaseConfig = {
    apiKey: "AIzaSyDhRoifzgbUBCQcSgyzAh8fkmtdFtsol-A",
    authDomain: "papera-game.firebaseapp.com",
    projectId: "papera-game",
    storageBucket: "papera-game.firebasestorage.app",
    messagingSenderId: "949145087126",
    appId: "1:949145087126:web:126563d4f19ba2746f66b7"
  };


  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const auth = getAuth(app);
  const authProvider = new GoogleAuthProvider();

  let totalCells = 60;
  let boardCreatedForCells = 0;
  let currentPlayerId = null;
  let currentTurnPlayerId = null;
  let currentQuestion = null;
  let isSubmittingAnswer = false;
  let hasShownPermissionAlert = false;
  let unsubscribePlayers = null;
  let unsubscribeGameInfo = null;
  const playersById = new Map();
  const fallbackColors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#34495e'];

  function isPermissionDenied(error) {
    return error?.code === 'permission-denied'
      || String(error?.message || '').toLowerCase().includes('missing or insufficient permissions');
  }

  function handlePermissionDenied(error, context) {
    console.error(`Permessi Firestore insufficienti (${context}):`, error);
    currentPlayerNameEl.textContent = 'Permessi Firestore insufficienti';
    currentPlayerNameEl.style.color = '#c0392b';
    btnRoll.disabled = true;

    if (!hasShownPermissionAlert) {
      hasShownPermissionAlert = true;
      alert('Firestore ha negato l\'accesso (Missing or insufficient permissions). Controlla le regole di sicurezza e, se usi regole basate su autenticazione, effettua il login utente prima di leggere/scrivere.');
    }
  }

  function resetGameStateForLogout() {
    if (unsubscribePlayers) {
      unsubscribePlayers();
      unsubscribePlayers = null;
    }

    if (unsubscribeGameInfo) {
      unsubscribeGameInfo();
      unsubscribeGameInfo = null;
    }

    currentPlayerId = null;
    currentTurnPlayerId = null;
    currentQuestion = null;
    playersById.clear();
    renderPawns();
    closeQuestionModal();
    updateTurnUi();
  }

  function buildDefaultName(user) {
    if (user.displayName && user.displayName.trim()) return user.displayName.trim();
    if (user.email && user.email.includes('@')) return user.email.split('@')[0];
    return 'Giocatore';
  }

  function pickColorForUid(uid) {
    let hash = 0;
    for (let i = 0; i < uid.length; i++) {
      hash = (hash << 5) - hash + uid.charCodeAt(i);
      hash |= 0;
    }

    const index = Math.abs(hash) % fallbackColors.length;
    return fallbackColors[index];
  }

  async function ensurePlayerProfile(user) {
    const playerRef = doc(db, 'giocatori', user.uid);
    const playerSnap = await getDoc(playerRef);

    if (!playerSnap.exists()) {
      const allPlayersSnap = await getDocs(collection(db, 'giocatori'));
      const nextTurnOrder = allPlayersSnap.size + 1;

      await setDoc(playerRef, {
        nome: buildDefaultName(user),
        email: user.email || null,
        posizione: 1,
        colore: pickColorForUid(user.uid),
        ordine_turno: nextTurnOrder,
        in_partita: true,
        domande_risposte: [],
        created_at: serverTimestamp(),
        updated_at: serverTimestamp()
      });
      return;
    }

    await setDoc(playerRef, {
      nome: buildDefaultName(user),
      email: user.email || null,
      updated_at: serverTimestamp()
    }, { merge: true });
  }

  function getActivePlayersEntries() {
    return Array.from(playersById.entries()).filter(([, player]) => player?.in_partita !== false);
  }

  function createBoard(cellsCount) {
    boardContainer.innerHTML = '';

    for (let i = 1; i <= cellsCount; i++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.id = `cell-${i}`;

      const spanNumber = document.createElement('span');
      spanNumber.classList.add('cell-number');
      spanNumber.textContent = i;
      cell.appendChild(spanNumber);

      const pawnsContainer = document.createElement('div');
      pawnsContainer.classList.add('pawns-container');
      pawnsContainer.id = `pawns-container-${i}`;
      cell.appendChild(pawnsContainer);

      boardContainer.appendChild(cell);
    }

    boardCreatedForCells = cellsCount;
  }

  function getPlayerInitials(name, fallbackId) {
    const source = String(name || '').trim();

    if (!source) {
      return String(fallbackId || '?').slice(0, 2).toUpperCase();
    }

    const tokens = source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);

    if (tokens.length === 0) {
      return String(fallbackId || '?').slice(0, 2).toUpperCase();
    }

    return tokens
      .map((token) => token[0])
      .join('')
      .toUpperCase();
  }

  function renderPawns() {
    const existingPawns = document.querySelectorAll('.pawn');
    existingPawns.forEach((pawn) => pawn.remove());

    getActivePlayersEntries().forEach(([playerId, player]) => {
      const rawPosition = Number(player.posizione) || 1;
      const clampedPosition = Math.max(1, Math.min(rawPosition, totalCells));
      const container = document.getElementById(`pawns-container-${clampedPosition}`);

      if (!container) return;

      const pawnDiv = document.createElement('div');
      pawnDiv.classList.add('pawn');
      pawnDiv.id = `pawn-${playerId}`;
      pawnDiv.style.backgroundColor = player.colore || '#666666';
      pawnDiv.title = player.nome || playerId;
      pawnDiv.textContent = getPlayerInitials(player.nome, playerId);
      pawnDiv.setAttribute('aria-label', `Pedina ${player.nome || playerId}`);
      container.appendChild(pawnDiv);
    });

    renderPlayersLegend();
  }

  function renderPlayersLegend() {
    if (!playersLegendListEl) return;

    const activePlayers = getActivePlayersEntries()
      .sort((a, b) => {
        const playerA = a[1] || {};
        const playerB = b[1] || {};
        const orderA = Number(playerA.ordine_turno);
        const orderB = Number(playerB.ordine_turno);

        if (Number.isFinite(orderA) && Number.isFinite(orderB) && orderA !== orderB) {
          return orderA - orderB;
        }

        const nameA = String(playerA.nome || a[0]);
        const nameB = String(playerB.nome || b[0]);
        return nameA.localeCompare(nameB);
      });

    if (activePlayers.length === 0) {
      playersLegendListEl.innerHTML = '<span class="legend-chip">Nessun giocatore attivo</span>';
      return;
    }

    playersLegendListEl.innerHTML = activePlayers
      .map(([playerId, player]) => {
        const name = player.nome || playerId;
        const initials = getPlayerInitials(player.nome, playerId);
        const color = player.colore || '#666666';

        return `
          <span class="legend-chip" title="${name}">
            <span class="legend-dot" style="background-color: ${color};">${initials}</span>
            <span>${name}</span>
          </span>
        `;
      })
      .join('');
  }

  function updateTurnUi() {
    const turnPlayer = playersById.get(currentTurnPlayerId);
    const isMyTurn = Boolean(currentPlayerId) && currentTurnPlayerId === currentPlayerId;

    if (!currentPlayerId) {
      currentPlayerNameEl.textContent = 'Accedi con Google per giocare';
      currentPlayerNameEl.style.color = '#333333';
      btnRoll.disabled = true;
      return;
    }

    if (turnPlayer) {
      currentPlayerNameEl.textContent = turnPlayer.nome || currentTurnPlayerId;
      currentPlayerNameEl.style.color = turnPlayer.colore || '#333333';
    } else if (currentTurnPlayerId) {
      currentPlayerNameEl.textContent = currentTurnPlayerId;
      currentPlayerNameEl.style.color = '#333333';
    } else {
      currentPlayerNameEl.textContent = 'In attesa...';
      currentPlayerNameEl.style.color = '#333333';
    }

    btnRoll.disabled = !isMyTurn;
  }

  function getNextPlayerId() {
    const orderedIds = Array
      .from(getActivePlayersEntries())
      .sort((a, b) => {
        const playerA = a[1] || {};
        const playerB = b[1] || {};
        const orderA = Number(playerA.ordine_turno);
        const orderB = Number(playerB.ordine_turno);

        if (Number.isFinite(orderA) && Number.isFinite(orderB) && orderA !== orderB) {
          return orderA - orderB;
        }

        const nameA = String(playerA.nome || a[0]);
        const nameB = String(playerB.nome || b[0]);
        return nameA.localeCompare(nameB);
      })
      .map(([id]) => id);

    if (orderedIds.length === 0) return null;

    const currentIndex = orderedIds.indexOf(currentPlayerId);
    if (currentIndex === -1) return orderedIds[0];
    return orderedIds[(currentIndex + 1) % orderedIds.length];
  }

  async function pickRandomQuestionExcluding(excludedIds) {
    const questionsSnapshot = await getDocs(collection(db, 'domande'));
    const available = [];

    questionsSnapshot.forEach((questionDoc) => {
      if (!excludedIds.has(questionDoc.id)) {
        available.push({ id: questionDoc.id, ...questionDoc.data() });
      }
    });

    if (available.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * available.length);
    return available[randomIndex];
  }

  function openQuestionModal(question) {
    currentQuestion = question;
    questionTextEl.textContent = question.testo || 'Domanda senza testo';
    answerInputEl.value = '';
    questionModal.classList.remove('hidden');
  }

  function closeQuestionModal() {
    questionModal.classList.add('hidden');
  }

  async function movePlayerAndAskQuestion() {
    const myPlayer = playersById.get(currentPlayerId);
    if (!myPlayer) {
      alert(`Giocatore ${currentPlayerId} non trovato in Firestore.`);
      return;
    }

    const diceValue = Math.floor(Math.random() * 6) + 1;
    const currentPosition = Number(myPlayer.posizione) || 1;
    const newPosition = Math.min(currentPosition + diceValue, totalCells);

    await updateDoc(doc(db, 'giocatori', currentPlayerId), {
      posizione: newPosition
    });

    const answeredIds = new Set(Array.isArray(myPlayer.domande_risposte) ? myPlayer.domande_risposte : []);
    const selectedQuestion = await pickRandomQuestionExcluding(answeredIds);

    if (!selectedQuestion) {
      alert('Non ci sono piu domande disponibili per questo giocatore.');
      await updateDoc(doc(db, 'stato_partita', 'info_generali'), {
        turno_attuale_id: getNextPlayerId()
      });
      return;
    }

    openQuestionModal(selectedQuestion);
  }

  async function submitAnswer() {
    if (isSubmittingAnswer || !currentQuestion) return;

    const answerText = answerInputEl.value.trim();
    if (!answerText) {
      alert('Scrivi una risposta prima di inviare.');
      return;
    }

    const player = playersById.get(currentPlayerId);
    if (!player) {
      alert('Impossibile trovare il giocatore corrente.');
      return;
    }

    isSubmittingAnswer = true;
    btnSubmitAnswer.disabled = true;

    try {
      await setDoc(doc(collection(db, 'risposte_date')), {
        id_giocatore: currentPlayerId,
        nome_giocatore: player.nome || currentPlayerId,
        email_giocatore: player.email || null,
        id_domanda: currentQuestion.id,
        testo_domanda: currentQuestion.testo || '',
        testo_risposta: answerText,
        timestamp: serverTimestamp()
      });

      await updateDoc(doc(db, 'giocatori', currentPlayerId), {
        domande_risposte: arrayUnion(currentQuestion.id),
        updated_at: serverTimestamp()
      });

      await updateDoc(doc(db, 'stato_partita', 'info_generali'), {
        turno_attuale_id: getNextPlayerId()
      });

      currentQuestion = null;
      closeQuestionModal();
    } catch (error) {
      if (isPermissionDenied(error)) {
        handlePermissionDenied(error, 'salvataggio risposta');
        return;
      }

      console.error('Errore durante il salvataggio della risposta:', error);
      alert('Errore nel salvataggio della risposta. Riprova.');
    } finally {
      isSubmittingAnswer = false;
      btnSubmitAnswer.disabled = false;
    }
  }

  function attachRealtimeListeners() {
    if (!currentPlayerId) return;

    unsubscribePlayers = onSnapshot(
      collection(db, 'giocatori'),
      (snapshot) => {
        playersById.clear();

        snapshot.forEach((playerDoc) => {
          playersById.set(playerDoc.id, playerDoc.data());
        });

        if (boardCreatedForCells !== totalCells) {
          createBoard(totalCells);
        }

        renderPawns();
        updateTurnUi();
      },
      (error) => {
        if (isPermissionDenied(error)) {
          handlePermissionDenied(error, 'listener giocatori');
          return;
        }

        console.error('Errore listener giocatori:', error);
      }
    );

    unsubscribeGameInfo = onSnapshot(
      doc(db, 'stato_partita', 'info_generali'),
      (snapshot) => {
        const gameInfo = snapshot.data() || {};
        const nextTotalCells = Number(gameInfo.totale_caselle) || 60;

        if (nextTotalCells !== totalCells) {
          totalCells = nextTotalCells;
          createBoard(totalCells);
          renderPawns();
        }

        currentTurnPlayerId = gameInfo.turno_attuale_id || null;
        updateTurnUi();
      },
      (error) => {
        if (isPermissionDenied(error)) {
          handlePermissionDenied(error, 'listener stato_partita');
          return;
        }

        console.error('Errore listener stato_partita:', error);
      }
    );
  }

  function attachEvents() {
    btnRoll.addEventListener('click', async () => {
      if (btnRoll.disabled) return;

      btnRoll.disabled = true;
      try {
        await movePlayerAndAskQuestion();
      } catch (error) {
        if (isPermissionDenied(error)) {
          handlePermissionDenied(error, 'turno giocatore');
          return;
        }

        console.error('Errore durante il turno:', error);
        alert('Errore durante il turno. Controlla la configurazione Firebase e riprova.');
      } finally {
        updateTurnUi();
      }
    });

    btnSubmitAnswer.addEventListener('click', submitAnswer);

    btnLoginGoogle.addEventListener('click', async () => {
      try {
        await signInWithPopup(auth, authProvider);
      } catch (error) {
        console.error('Errore login Google:', error);
        alert('Login Google non riuscito. Riprova.');
      }
    });

    btnLogout.addEventListener('click', async () => {
      try {
        await signOut(auth);
      } catch (error) {
        console.error('Errore logout:', error);
        alert('Logout non riuscito. Riprova.');
      }
    });
  }

  function attachAuthListener() {
    onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          authUserNameEl.textContent = 'Non autenticato';
          btnLoginGoogle.classList.remove('hidden');
          btnLogout.classList.add('hidden');
          resetGameStateForLogout();
          return;
        }

        currentPlayerId = user.uid;
        authUserNameEl.textContent = user.displayName || user.email || user.uid;
        btnLoginGoogle.classList.add('hidden');
        btnLogout.classList.remove('hidden');

        await ensurePlayerProfile(user);

        if (unsubscribePlayers || unsubscribeGameInfo) {
          resetGameStateForLogout();
          currentPlayerId = user.uid;
        }

        attachRealtimeListeners();
      } catch (error) {
        if (isPermissionDenied(error)) {
          handlePermissionDenied(error, 'profilo giocatore');
          return;
        }

        console.error('Errore gestione stato autenticazione:', error);
      }
    });
  }

  async function bootstrap() {
    createBoard(totalCells);
    attachEvents();
    attachAuthListener();

    // Validazione leggera per evitare inizializzazione con config placeholder.
    if (firebaseConfig.projectId === 'REPLACE_ME') {
      currentPlayerNameEl.textContent = 'Config Firebase mancante';
      btnRoll.disabled = true;
      alert('Incolla la tua firebaseConfig in app.js prima di avviare il gioco.');
      return;
    }
  }

  bootstrap().catch((error) => {
    if (isPermissionDenied(error)) {
      handlePermissionDenied(error, 'bootstrap');
      return;
    }

    console.error('Errore inizializzazione app:', error);
    currentPlayerNameEl.textContent = 'Errore di inizializzazione';
    btnRoll.disabled = true;
    alert('Errore inizializzazione Firebase/Firestore. Controlla console e configurazione.');
  });
});