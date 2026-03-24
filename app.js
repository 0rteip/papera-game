document.addEventListener('DOMContentLoaded', () => {
  const boardContainer = document.getElementById('board');
  const totalCells = 60; // Numero di caselle del tuo gioco

  // 1. Genera il tabellone dinamicamente
  function createBoard() {
    for (let i = 1; i <= totalCells; i++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.id = `cell-${i}`;
      cell.textContent = i; // Mostra il numero della casella
      
      boardContainer.appendChild(cell);
    }
  }

  // 2. Simula il caricamento dei dati (In futuro qui ci sarà Firebase)
  function initGame() {
    createBoard();
    
    // Fingiamo che il database ci dica che tocca a Marco
    document.getElementById('current-player-name').textContent = "Marco";
    
    // Se tocca all'utente attuale, attiviamo il bottone del dado
    const btnRoll = document.getElementById('btn-roll-dice');
    btnRoll.disabled = false; 

    // Event Listener per il dado
    btnRoll.addEventListener('click', () => {
      const diceValue = Math.floor(Math.random() * 6) + 1;
      alert(`Hai tirato un ${diceValue}!`);
      // Qui aggiungeremo l'animazione della pedina e l'apertura della domanda
    });
  }

  initGame();
});