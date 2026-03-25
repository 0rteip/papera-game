import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
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
  const diceOverlayEl = document.getElementById('dice-result-overlay');
  const diceResultValueEl = document.getElementById('dice-result-value');
  const bonusEventTextEl = document.getElementById('bonus-event-text');
  const gameOverBannerEl = document.getElementById('game-over-banner');
  const gameOverConfettiEl = document.getElementById('game-over-confetti');
  const gameOverTitleEl = document.getElementById('game-over-title');
  const gameOverSubtitleEl = document.getElementById('game-over-subtitle');
  const btnGameOverClose = document.getElementById('btn-game-over-close');


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

  let totalCells = 48;
  let boardCreatedForCells = 0;
  let lastBoardColumns = 0;
  let currentPlayerId = null;
  let currentTurnPlayerId = null;
  let currentGameId = null;
  let currentQuestion = null;
  let currentQuestionBonusType = null;
  let gameOverWinnerId = null;
  let isSubmittingAnswer = false;
  let hasShownPermissionAlert = false;
  let unsubscribePlayers = null;
  let unsubscribeGameInfo = null;
  let unsubscribeQuestions = null;
  const playersById = new Map();
  const activeQuestionsCache = [];
  const fallbackColors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#34495e'];
  const BONUS_CELLS = new Map([
    [3, { type: 'forward', value: 2, label: '+2' }],
    [6, { type: 'forward', value: 3, label: '+3' }],
    [8, { type: 'reroll', label: 'Ancora' }],
    [11, { type: 'backward', value: 2, label: '-2' }],
    [14, { type: 'forward', value: 2, label: '+2' }],
    [18, { type: 'reroll', label: 'Ancora' }],
    [21, { type: 'backward', value: 2, label: '-2' }],
    [24, { type: 'forward', value: 4, label: '+4' }],
    [27, { type: 'reroll', label: 'Ancora' }],
    [30, { type: 'forward', value: 2, label: '+2' }],
    [33, { type: 'backward', value: 3, label: '-3' }],
    [37, { type: 'forward', value: 3, label: '+3' }],
    [41, { type: 'reroll', label: 'Ancora' }],
    [44, { type: 'backward', value: 2, label: '-2' }]
  ]);

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

    if (unsubscribeQuestions) {
      unsubscribeQuestions();
      unsubscribeQuestions = null;
    }

    currentPlayerId = null;
    currentTurnPlayerId = null;
    currentGameId = null;
    currentQuestion = null;
    currentQuestionBonusType = null;
    gameOverWinnerId = null;
    playersById.clear();
    activeQuestionsCache.length = 0;
    hideGameOverBanner();
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
      const nextTurnOrder = Date.now();

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

  function getBoardColumns() {
    const raw = getComputedStyle(boardContainer).getPropertyValue('--board-columns').trim();
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
  }

  function getPathPosition(index, columns) {
    const row = Math.floor(index / columns);
    const posInRow = index % columns;
    const col = row % 2 === 0 ? posInRow : (columns - 1 - posInRow);
    return { row, col };
  }

  function getNextDirection(index, cellsCount, columns) {
    if (index >= cellsCount - 1) return 'none';

    const current = getPathPosition(index, columns);
    const next = getPathPosition(index + 1, columns);

    if (next.row > current.row) return 'down';
    if (next.col > current.col) return 'right';
    return 'left';
  }

  function createBoard(cellsCount) {
    boardContainer.innerHTML = '';
    const columns = getBoardColumns();
    lastBoardColumns = columns;

    for (let i = 1; i <= cellsCount; i++) {
      const index = i - 1;
      const pathPos = getPathPosition(index, columns);
      const nextDirection = getNextDirection(index, cellsCount, columns);
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.id = `cell-${i}`;
      cell.style.gridColumn = String(pathPos.col + 1);
      cell.style.gridRow = String(pathPos.row + 1);
      cell.dataset.nextDirection = nextDirection;

      const bonus = BONUS_CELLS.get(i);
      if (bonus) {
        cell.classList.add('bonus-cell', `bonus-${bonus.type}`);

        const badge = document.createElement('span');
        badge.classList.add('bonus-badge');
        badge.textContent = bonus.label;
        cell.appendChild(badge);
      }

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
      pawnDiv.style.setProperty('--pawn-color', player.colore || '#666666');
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

  function getWinnerEntry() {
    return getActivePlayersEntries().find(([, player]) => {
      const position = Number(player?.posizione) || 1;
      return position >= totalCells;
    }) || null;
  }

  function updateTurnUi() {
    const winnerEntry = getWinnerEntry();
    if (winnerEntry) {
      const [winnerId, winner] = winnerEntry;
      currentPlayerNameEl.textContent = `Ha vinto ${winner?.nome || winnerId}!`;
      currentPlayerNameEl.style.color = winner?.colore || '#2e7d32';
      btnRoll.disabled = true;
      if (gameOverWinnerId !== winnerId) {
        gameOverWinnerId = winnerId;
        showGameOverBanner(winnerId, winner);
      }
      return;
    }

    if (gameOverWinnerId !== null) {
      gameOverWinnerId = null;
      hideGameOverBanner();
    }

    const turnPlayer = playersById.get(currentTurnPlayerId);
    const isMyTurn = Boolean(currentPlayerId) && currentTurnPlayerId === currentPlayerId;
    const currentPlayer = playersById.get(currentPlayerId);
    const hasPendingQuestion = Boolean(currentPlayer?.domanda_corrente_id);

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

    btnRoll.disabled = !isMyTurn || hasPendingQuestion;
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
    const available = [];

    activeQuestionsCache.forEach((question) => {
      if (!excludedIds.has(question.id)) {
        available.push(question);
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

  function showBonusNotice(text) {
    if (!bonusEventTextEl) return;

    bonusEventTextEl.textContent = text;
    bonusEventTextEl.classList.remove('hidden');

    window.setTimeout(() => {
      bonusEventTextEl.classList.add('hidden');
    }, 2200);
  }

  function hideGameOverBanner() {
    if (!gameOverBannerEl) return;
    gameOverBannerEl.classList.add('hidden');
  }

  function spawnConfettiBurst() {
    if (!gameOverConfettiEl) return;

    const colors = ['#ffd54f', '#29b6f6', '#ef5350', '#66bb6a', '#ab47bc', '#ffa726'];
    const pieces = 44;
    gameOverConfettiEl.innerHTML = '';

    for (let i = 0; i < pieces; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 260}px`);
      piece.style.setProperty('--duration', `${1700 + Math.random() * 1900}ms`);
      piece.style.animationDelay = `${Math.random() * 350}ms`;
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      gameOverConfettiEl.appendChild(piece);
    }
  }

  function showGameOverBanner(winnerId, winnerData) {
    if (!gameOverBannerEl) return;

    const winnerName = winnerData?.nome || winnerId || 'Una papera';

    if (gameOverTitleEl) {
      gameOverTitleEl.textContent = `${winnerName} ha vinto!`;
    }

    if (gameOverSubtitleEl) {
      gameOverSubtitleEl.textContent = 'La papera più veloce!';
    }

    gameOverBannerEl.classList.remove('hidden');
    spawnConfettiBurst();
  }

  function applyBonus(position) {
    const bonus = BONUS_CELLS.get(position);
    if (!bonus) {
      return {
        finalPosition: position,
        bonusType: null,
        bonusText: ''
      };
    }

    if (bonus.type === 'forward') {
      const finalPosition = Math.min(totalCells, position + Number(bonus.value || 0));
      return {
        finalPosition,
        bonusType: 'forward',
        bonusText: `Bonus! Avanzi di ${bonus.value} caselle (arrivi alla ${finalPosition}).`
      };
    }

    if (bonus.type === 'backward') {
      const finalPosition = Math.max(1, position - Number(bonus.value || 0));
      return {
        finalPosition,
        bonusType: 'backward',
        bonusText: `Ops! Torni indietro di ${bonus.value} caselle (arrivi alla ${finalPosition}).`
      };
    }

    return {
      finalPosition: position,
      bonusType: 'reroll',
      bonusText: 'Bonus! Dopo la risposta, tocchera ancora a te tirare il dado.'
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function flashCellTwice(cellNumber) {
    const cell = document.getElementById(`cell-${cellNumber}`);
    if (!cell) return;

    for (let i = 0; i < 2; i++) {
      cell.classList.remove('start-flash');
      // Force reflow so animation reliably restarts each loop.
      void cell.offsetWidth;
      cell.classList.add('start-flash');
      await sleep(700);
    }

    cell.classList.remove('start-flash');
  }

  async function showDiceRoll(resultValue) {
    if (!diceOverlayEl || !diceResultValueEl) return;

    diceOverlayEl.classList.remove('hidden');
    diceResultValueEl.classList.remove('revealed');

    for (let i = 0; i < 8; i++) {
      const rollingValue = Math.floor(Math.random() * 6) + 1;
      diceResultValueEl.textContent = String(rollingValue);
      await sleep(85);
    }

    diceResultValueEl.textContent = String(resultValue);
    diceResultValueEl.classList.add('revealed');

    await sleep(700);
    diceOverlayEl.classList.add('hidden');
  }

  async function movePlayerAndAskQuestion() {
    if (getWinnerEntry()) {
      showBonusNotice('La partita e gia finita.');
      return;
    }

    const myPlayer = playersById.get(currentPlayerId);
    if (!myPlayer) {
      alert(`Giocatore ${currentPlayerId} non trovato in Firestore.`);
      return;
    }

    if (myPlayer.domanda_corrente_id) {
      currentQuestionBonusType = myPlayer.domanda_bonus_tipo || null;
      openQuestionModal({
        id: myPlayer.domanda_corrente_id,
        testo: myPlayer.domanda_corrente_testo || 'Domanda senza testo'
      });
      return;
    }

    const wasPendingReroll = currentQuestionBonusType === 'pending_reroll';
    const diceValue = Math.floor(Math.random() * 6) + 1;
    const currentPosition = Number(myPlayer.posizione) || 1;
    const landedPosition = Math.min(currentPosition + diceValue, totalCells);
    const bonusResult = applyBonus(landedPosition);
    const finalPosition = bonusResult.finalPosition;
    currentQuestionBonusType = null;

    await flashCellTwice(currentPosition);
    await showDiceRoll(diceValue);

    await updateDoc(doc(db, 'giocatori', currentPlayerId), {
      posizione: landedPosition
    });

    await flashCellTwice(landedPosition);

    if (bonusResult.bonusText) {
      showBonusNotice(`Casella speciale! ${bonusResult.bonusText}`);
      await sleep(900);
    }

    if ((bonusResult.bonusType === 'forward' || bonusResult.bonusType === 'backward') && finalPosition !== landedPosition) {
      await updateDoc(doc(db, 'giocatori', currentPlayerId), {
        posizione: finalPosition
      });

      await flashCellTwice(finalPosition);
    }

    const endingPosition = (bonusResult.bonusType === 'forward' || bonusResult.bonusType === 'backward')
      ? finalPosition
      : landedPosition;

    if (endingPosition >= totalCells) {
      showBonusNotice('Traguardo raggiunto! Hai vinto la partita!');
      currentQuestionBonusType = null;
      updateTurnUi();
      return;
    }

    if (bonusResult.bonusType === 'reroll') {
      currentQuestionBonusType = 'pending_reroll';
      showBonusNotice(
        wasPendingReroll
          ? 'Ancora! Niente domanda: ritira di nuovo finche esci da una casella Ancora.'
          : 'Casella Ancora! Rilancia il dado: la domanda arrivera dopo il prossimo lancio.'
      );
      updateTurnUi();
      return;
    }

    const answeredIds = new Set(Array.isArray(myPlayer.domande_risposte) ? myPlayer.domande_risposte : []);
    const selectedQuestion = await pickRandomQuestionExcluding(answeredIds);

    if (!selectedQuestion) {
      alert('Non ci sono piu domande disponibili per questo giocatore.');
      await updateDoc(doc(db, 'stato_partita', 'info_generali'), {
        turno_attuale_id: getNextPlayerId()
      });
      currentQuestionBonusType = null;
      return;
    }

    await updateDoc(doc(db, 'giocatori', currentPlayerId), {
      domanda_corrente_id: selectedQuestion.id,
      domanda_corrente_testo: selectedQuestion.testo || '',
      domanda_bonus_tipo: deleteField(),
      updated_at: serverTimestamp()
    });

    await sleep(450);

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
        partita_id: currentGameId || 'partita-sconosciuta',
        nome_giocatore: player.nome || currentPlayerId,
        email_giocatore: player.email || null,
        id_domanda: currentQuestion.id,
        testo_domanda: currentQuestion.testo || '',
        testo_risposta: answerText,
        timestamp: serverTimestamp()
      });

      await updateDoc(doc(db, 'giocatori', currentPlayerId), {
        domande_risposte: arrayUnion(currentQuestion.id),
        domanda_corrente_id: deleteField(),
        domanda_corrente_testo: deleteField(),
        domanda_bonus_tipo: deleteField(),
        updated_at: serverTimestamp()
      });

      await updateDoc(doc(db, 'stato_partita', 'info_generali'), {
        turno_attuale_id: getNextPlayerId()
      });

      currentQuestion = null;
      currentQuestionBonusType = null;
      closeQuestionModal();
      updateTurnUi();
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

    unsubscribeQuestions = onSnapshot(
      collection(db, 'domande'),
      (snapshot) => {
        activeQuestionsCache.length = 0;

        snapshot.forEach((questionDoc) => {
          const data = questionDoc.data() || {};
          if (data.attiva !== false) {
            activeQuestionsCache.push({
              id: questionDoc.id,
              testo: data.testo || ''
            });
          }
        });
      },
      (error) => {
        if (isPermissionDenied(error)) {
          handlePermissionDenied(error, 'listener domande');
          return;
        }

        console.error('Errore listener domande:', error);
      }
    );

    unsubscribePlayers = onSnapshot(
      collection(db, 'giocatori'),
      (snapshot) => {
        playersById.clear();

        snapshot.forEach((playerDoc) => {
          playersById.set(playerDoc.id, playerDoc.data());
        });

        if (boardCreatedForCells !== totalCells) {
          createBoard(totalCells);
        } else {
          const columns = getBoardColumns();
          if (columns !== lastBoardColumns) {
            createBoard(totalCells);
          }
        }

        const me = playersById.get(currentPlayerId);
        if (me?.domanda_corrente_id) {
          currentQuestionBonusType = me.domanda_bonus_tipo || null;
          if (!currentQuestion || currentQuestion.id !== me.domanda_corrente_id) {
            openQuestionModal({
              id: me.domanda_corrente_id,
              testo: me.domanda_corrente_testo || 'Domanda senza testo'
            });
          }
        } else if (currentQuestion && currentQuestion.id) {
          closeQuestionModal();
          currentQuestion = null;
          currentQuestionBonusType = null;
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
        const nextTotalCells = Number(gameInfo.totale_caselle) || 48;

        if (nextTotalCells !== totalCells) {
          totalCells = nextTotalCells;
          createBoard(totalCells);
          renderPawns();
        }

        currentTurnPlayerId = gameInfo.turno_attuale_id || null;
        currentGameId = typeof gameInfo.partita_id === 'string' && gameInfo.partita_id.trim()
          ? gameInfo.partita_id.trim()
          : null;
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

    if (btnGameOverClose) {
      btnGameOverClose.addEventListener('click', () => {
        hideGameOverBanner();
      });
    }
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

        if (unsubscribePlayers || unsubscribeGameInfo || unsubscribeQuestions) {
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

    window.addEventListener('resize', () => {
      const columns = getBoardColumns();
      if (columns !== lastBoardColumns) {
        createBoard(totalCells);
        renderPawns();
      }
    });

    // Validazione leggera per evitare inizializzazione con config placeholder.
    if (firebaseConfig.projectId === 'REPLACE_ME') {
      currentPlayerNameEl.textContent = 'Config Firebase mancante';
      btnRoll.disabled = true;
      alert('Incolla la tua firebaseConfig in app.js prima di avviare il gioco.');
      return;
    }
  }

  function startBootstrap() {
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
  }

  if (document.readyState === 'complete') {
    startBootstrap();
  } else {
    window.addEventListener('load', startBootstrap, { once: true });
  }
});