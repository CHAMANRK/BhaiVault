// ╔══════════════════════════════════════════════════════╗
// ║  BhaiChara — game.js (Mini Game System)              ║
// ║  Tic-Tac-Toe + Rock Paper Scissors                   ║
// ║  Works in 1v1 private chat + Group chat              ║
// ╚══════════════════════════════════════════════════════╝

import { getDatabase, ref, set, get, onValue, off, update, push } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ── Game State ─────────────────────────────────────────
let _db            = null;
let _currentUser   = null;
let _currentChat   = null;
let _gameListener  = null;
let _activeGameId  = null;
let _activeGameRef = null;

// ── Init — app.js se call karo ──────────────────────────
export function initGameSystem(db, currentUser, getCurrentChat) {
  _db = db;
  _currentUser = currentUser;
  window._getGameCurrentChat = getCurrentChat; // live getter
}

function getCC() {
  return window._getGameCurrentChat ? window._getGameCurrentChat() : null;
}

// ─────────────────────────────────────────────────────────
//  GAME LOBBY — Chat mein available games list dikhao
// ─────────────────────────────────────────────────────────
window.openGameLobby = function() {
  const chat = getCC();
  if (!chat) { showGameToast("Pehle koi chat open karo bhai!"); return; }
  document.getElementById("game-lobby-modal").classList.remove("hidden");
};

window.closeGameLobby = function() {
  document.getElementById("game-lobby-modal").classList.add("hidden");
};

// ─────────────────────────────────────────────────────────
//  INVITE SEND
// ─────────────────────────────────────────────────────────
window.sendGameInvite = async function(gameType) {
  const chat = getCC();
  if (!chat) return;

  closeGameLobby();

  const gameId    = push(ref(_db, "games")).key;
  const inviterId = _currentUser.uid;
  const chatId    = chat.id;
  const chatType  = chat.type; // "private" or "group"

  const gameData = {
    gameType,           // "ttt" or "rps"
    status:   "pending",
    chatId,
    chatType,
    inviterId,
    inviterName: _currentUser.name,
    inviterAvatar: _currentUser.avatar || "?",
    createdAt: Date.now(),
    members: chatType === "group" ? null : [inviterId],
  };

  await set(ref(_db, `games/${gameId}`), gameData);

  // Game invite message chat mein bhejo
  const msgKey = push(ref(_db, `messages/${chatId}`)).key;
  const ts     = Date.now();

  await set(ref(_db, `messages/${chatId}/${msgKey}`), {
    type:        "game_invite",
    gameId,
    gameType,
    senderId:    inviterId,
    senderName:  _currentUser.name,
    senderAvatar: _currentUser.avatar || "?",
    timestamp:   ts,
    status:      "sent",
  });

  // Update chat preview
  const membersSnap = await get(ref(_db, chatType === "group"
    ? `groups/${chatId}/members`
    : `chats/${chatId}/members`));
  const members = membersSnap.val() || [];
  const gameName = gameType === "ttt" ? "Tic-Tac-Toe ❌⭕" : "Rock Paper Scissors ✊";

  for (const mId of members) {
    await update(ref(_db, `user_chats/${mId}/${chatId}`), {
      lastMessage:     `🎮 ${_currentUser.name} ne game invite bheja: ${gameName}`,
      lastMessageTime: ts,
    });
  }

  showGameToast(`🎮 Game invite bheja! Dono online hone pe khelenge.`);
};

// ─────────────────────────────────────────────────────────
//  ACCEPT INVITE
// ─────────────────────────────────────────────────────────
window.acceptGameInvite = async function(gameId) {
  const snap = await get(ref(_db, `games/${gameId}`));
  if (!snap.exists()) { showGameToast("Game expire ho gayi bhai!"); return; }
  const game = snap.val();

  if (game.status !== "pending") {
    showGameToast("Game already shuru ho chuki ya khatam ho gayi!");
    return;
  }
  if (game.inviterId === _currentUser.uid) {
    showGameToast("Tu khud hi invite kiya tha 😂 Doosre ka wait karo!");
    return;
  }

  // Assign symbols / roles
  const updates = {
    status:    "active",
    acceptorId:    _currentUser.uid,
    acceptorName:  _currentUser.name,
    acceptorAvatar: _currentUser.avatar || "?",
    startedAt:     Date.now(),
  };

  if (game.gameType === "ttt") {
    // Inviter = X, Acceptor = O, Inviter starts first
    updates.board      = Array(9).fill(null);
    updates.currentTurn = game.inviterId;
    updates.playerX    = game.inviterId;
    updates.playerO    = _currentUser.uid;
    updates.winner     = null;
    updates.draw       = false;
  } else if (game.gameType === "rps") {
    updates.round      = 1;
    updates.maxRounds  = 3;
    updates.scores     = { [game.inviterId]: 0, [_currentUser.uid]: 0 };
    updates.currentChoices = {};
    updates.roundResult = null;
  }

  await update(ref(_db, `games/${gameId}`), updates);
  openGameBoard(gameId, game.gameType);
};

// ─────────────────────────────────────────────────────────
//  DECLINE INVITE
// ─────────────────────────────────────────────────────────
window.declineGameInvite = async function(gameId) {
  await update(ref(_db, `games/${gameId}`), { status: "declined" });
  showGameToast("Game decline kar di.");
};

// ─────────────────────────────────────────────────────────
//  OPEN GAME BOARD (listen + render)
// ─────────────────────────────────────────────────────────
window.openGameBoard = function(gameId, gameType) {
  _activeGameId = gameId;

  // Remove old listener
  if (_activeGameRef) off(_activeGameRef);

  _activeGameRef = ref(_db, `games/${gameId}`);
  _gameListener  = onValue(_activeGameRef, snap => {
    if (!snap.exists()) return;
    const game = snap.val();
    if (gameType === "ttt" || game.gameType === "ttt") renderTTT(game, gameId);
    else renderRPS(game, gameId);
  });

  document.getElementById("game-board-modal").classList.remove("hidden");
};

window.closeGameBoard = function() {
  document.getElementById("game-board-modal").classList.add("hidden");
  if (_activeGameRef) { off(_activeGameRef); _activeGameRef = null; }
  _activeGameId = null;
};

// ─────────────────────────────────────────────────────────
//  TIC-TAC-TOE LOGIC
// ─────────────────────────────────────────────────────────
function renderTTT(game, gameId) {
  const modal     = document.getElementById("game-board-modal");
  const isX       = game.playerX === _currentUser.uid;
  const mySymbol  = isX ? "X" : "O";
  const oppSymbol = isX ? "O" : "X";
  const myName    = _currentUser.name;
  const oppName   = isX ? (game.acceptorName || "Opponent") : (game.inviterName || "Opponent");
  const isMyTurn  = game.currentTurn === _currentUser.uid;
  const board     = game.board || Array(9).fill(null);

  let statusText = "";
  let statusClass = "";
  if (game.status === "pending") {
    statusText = "⏳ Opponent ka wait ho raha hai...";
  } else if (game.winner) {
    if (game.winner === _currentUser.uid) {
      statusText = "🏆 Tu jeet gaya bhai!";
      statusClass = "win";
    } else {
      statusText = "💀 Tu haar gaya!";
      statusClass = "lose";
    }
  } else if (game.draw) {
    statusText = "🤝 Draw ho gaya!";
    statusClass = "draw";
  } else if (game.status === "declined") {
    statusText = "❌ Opponent ne decline kar diya.";
  } else {
    statusText = isMyTurn ? "⚡ Teri baari hai!" : `⏳ ${oppName} soch raha hai...`;
    statusClass = isMyTurn ? "myturn" : "";
  }

  const gameOver = !!(game.winner || game.draw || game.status === "declined" || game.status === "pending");

  modal.querySelector(".game-modal-inner").innerHTML = `
    <div class="game-header">
      <button class="game-close-btn" onclick="closeGameBoard()">✕</button>
      <div class="game-title">Tic-Tac-Toe ❌⭕</div>
      <div class="game-players">
        <div class="gp ${isX ? 'me' : ''}">
          <span class="gp-avatar">${_currentUser.avatar || "?"}</span>
          <span class="gp-name">${myName}</span>
          <span class="gp-sym">${mySymbol}</span>
        </div>
        <span class="gp-vs">VS</span>
        <div class="gp ${!isX ? 'me' : ''}">
          <span class="gp-avatar">${isX ? (game.acceptorAvatar || "?") : (game.inviterAvatar || "?")}</span>
          <span class="gp-name">${oppName}</span>
          <span class="gp-sym">${oppSymbol}</span>
        </div>
      </div>
    </div>

    <div class="game-status ${statusClass}">${statusText}</div>

    <div class="ttt-board" id="ttt-board">
      ${board.map((cell, i) => `
        <button class="ttt-cell ${cell ? 'filled ' + cell.toLowerCase() : ''} ${!gameOver && isMyTurn && !cell ? 'clickable' : ''}"
          onclick="${!gameOver && isMyTurn && !cell ? `playTTT('${gameId}', ${i})` : ''}"
        >${cell === "X" ? "❌" : cell === "O" ? "⭕" : ""}</button>
      `).join("")}
    </div>

    ${gameOver && game.status !== "pending" ? `
      <div class="game-actions">
        <button class="game-btn primary" onclick="sendGameInvite('ttt')">🔄 Rematch</button>
        <button class="game-btn ghost" onclick="closeGameBoard()">Baad Mein</button>
      </div>
    ` : ""}
  `;
}

window.playTTT = async function(gameId, cellIndex) {
  const snap = await get(ref(_db, `games/${gameId}`));
  if (!snap.exists()) return;
  const game = snap.val();

  if (game.currentTurn !== _currentUser.uid) return;
  if (game.board[cellIndex] !== null) return;
  if (game.status !== "active") return;

  const board    = [...game.board];
  const mySymbol = game.playerX === _currentUser.uid ? "X" : "O";
  board[cellIndex] = mySymbol;

  const winner = checkTTTWinner(board);
  const isDraw = !winner && board.every(c => c !== null);

  const updates = {
    board,
    currentTurn: mySymbol === "X" ? game.playerO : game.playerX,
  };

  if (winner) {
    updates.winner  = _currentUser.uid;
    updates.status  = "finished";
    // Notify in chat
    notifyGameResult(game.chatId, game.chatType, `🏆 ${_currentUser.name} ne Tic-Tac-Toe jeeta!`);
  } else if (isDraw) {
    updates.draw   = true;
    updates.status = "finished";
    notifyGameResult(game.chatId, game.chatType, `🤝 Tic-Tac-Toe mein Draw! Ekdum bakkar match!`);
  }

  await update(ref(_db, `games/${gameId}`), updates);
};

function checkTTTWinner(board) {
  const lines = [
    [0,1,2],[3,4,5],[6,7,8], // rows
    [0,3,6],[1,4,7],[2,5,8], // cols
    [0,4,8],[2,4,6]          // diagonals
  ];
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

// ─────────────────────────────────────────────────────────
//  ROCK PAPER SCISSORS LOGIC
// ─────────────────────────────────────────────────────────
const RPS_LABELS = { rock: "✊", paper: "✋", scissors: "✌️" };

function renderRPS(game, gameId) {
  const modal    = document.getElementById("game-board-modal");
  const myId     = _currentUser.uid;
  const oppId    = game.inviterId === myId ? game.acceptorId : game.inviterId;
  const oppName  = game.inviterId === myId ? (game.acceptorName || "Opponent") : (game.inviterName || "Opponent");
  const scores   = game.scores || {};
  const myScore  = scores[myId] || 0;
  const oppScore = scores[oppId] || 0;
  const choices  = game.currentChoices || {};
  const myChoice = choices[myId];
  const oppChoice= choices[oppId];
  const bothChose= !!(myChoice && oppChoice);

  let statusText = "", statusClass = "";
  if (game.status === "pending") {
    statusText  = "⏳ Opponent ka wait ho raha hai...";
  } else if (game.status === "finished") {
    if (myScore > oppScore)       { statusText = `🏆 Tu jeet gaya! ${myScore}-${oppScore}`; statusClass = "win"; }
    else if (myScore < oppScore)  { statusText = `💀 Tu haar gaya! ${myScore}-${oppScore}`; statusClass = "lose"; }
    else                           { statusText = `🤝 Draw! ${myScore}-${oppScore}`; statusClass = "draw"; }
  } else if (bothChose && game.roundResult) {
    const rr = game.roundResult;
    if      (rr === myId)   { statusText = `Round ${game.round - 1}: ✅ Tu jeeta!`; statusClass = "myturn"; }
    else if (rr === "draw") { statusText = `Round ${game.round - 1}: 🤝 Draw!`; statusClass = "draw"; }
    else                    { statusText = `Round ${game.round - 1}: ❌ Haar gaya!`; statusClass = "lose"; }
  } else if (myChoice && !oppChoice) {
    statusText = "✅ Teri choice lock! Opponent ka wait...";
  } else if (!myChoice) {
    statusText = `Round ${game.round}/${game.maxRounds}: Apni move choose karo!`;
    statusClass = "myturn";
  }

  const gameOver = game.status === "finished";
  const canPlay  = !gameOver && !myChoice && game.status === "active";

  modal.querySelector(".game-modal-inner").innerHTML = `
    <div class="game-header">
      <button class="game-close-btn" onclick="closeGameBoard()">✕</button>
      <div class="game-title">Rock Paper Scissors ✊</div>
      <div class="game-players">
        <div class="gp me">
          <span class="gp-avatar">${_currentUser.avatar || "?"}</span>
          <span class="gp-name">${_currentUser.name}</span>
          <span class="gp-score">${myScore}</span>
        </div>
        <span class="gp-vs">VS</span>
        <div class="gp">
          <span class="gp-avatar">${(game.inviterId === myId ? game.acceptorAvatar : game.inviterAvatar) || "?"}</span>
          <span class="gp-name">${oppName}</span>
          <span class="gp-score">${oppScore}</span>
        </div>
      </div>
    </div>

    <div class="game-status ${statusClass}">${statusText}</div>

    ${bothChose ? `
      <div class="rps-reveal">
        <div class="rps-reveal-side">
          <span class="rps-big-emoji">${RPS_LABELS[myChoice]}</span>
          <span class="rps-reveal-name">Tu</span>
        </div>
        <span class="rps-reveal-vs">⚔️</span>
        <div class="rps-reveal-side">
          <span class="rps-big-emoji">${RPS_LABELS[oppChoice]}</span>
          <span class="rps-reveal-name">${oppName}</span>
        </div>
      </div>
    ` : myChoice ? `
      <div class="rps-waiting">
        <span class="rps-locked">${RPS_LABELS[myChoice]}</span>
        <p>Locked! Opponent soch raha hai... 🤔</p>
      </div>
    ` : ""}

    ${canPlay ? `
      <div class="rps-choices">
        <button class="rps-choice-btn" onclick="playRPS('${gameId}','rock')">✊<span>Rock</span></button>
        <button class="rps-choice-btn" onclick="playRPS('${gameId}','paper')">✋<span>Paper</span></button>
        <button class="rps-choice-btn" onclick="playRPS('${gameId}','scissors')">✌️<span>Scissors</span></button>
      </div>
    ` : ""}

    ${gameOver ? `
      <div class="game-actions">
        <button class="game-btn primary" onclick="sendGameInvite('rps')">🔄 Rematch</button>
        <button class="game-btn ghost" onclick="closeGameBoard()">Baad Mein</button>
      </div>
    ` : (bothChose && !gameOver) ? `
      <div class="game-actions">
        <button class="game-btn primary" onclick="nextRPSRound('${gameId}')">➡️ Next Round</button>
      </div>
    ` : ""}
  `;
}

window.playRPS = async function(gameId, choice) {
  const snap = await get(ref(_db, `games/${gameId}`));
  if (!snap.exists()) return;
  const game = snap.val();

  if (game.status !== "active") return;
  const choices = game.currentChoices || {};
  if (choices[_currentUser.uid]) { showGameToast("Pehle se choose kar chuka hai! 😂"); return; }

  choices[_currentUser.uid] = choice;

  const myId  = _currentUser.uid;
  const oppId = game.inviterId === myId ? game.acceptorId : game.inviterId;

  const updates = { currentChoices: choices };

  // Dono ne choose kiya — result nikalo
  if (choices[oppId]) {
    const result = getRPSResult(choice, choices[oppId]);
    const scores = { ...(game.scores || {}) };
    let roundResult = "draw";

    if (result === "win") {
      scores[myId] = (scores[myId] || 0) + 1;
      roundResult   = myId;
    } else if (result === "lose") {
      scores[oppId] = (scores[oppId] || 0) + 1;
      roundResult    = oppId;
    }

    updates.scores      = scores;
    updates.roundResult = roundResult;
    updates.roundReveal = true;

    // Check if match over (best of 3)
    const newRound = (game.round || 1) + 1;
    if (newRound > (game.maxRounds || 3)) {
      updates.status = "finished";
      updates.round  = newRound;
      const myFinal  = scores[myId] || 0;
      const oppFinal = scores[oppId] || 0;
      let resultMsg = "";
      if (myFinal > oppFinal)  resultMsg = `🏆 ${_currentUser.name} ne Rock Paper Scissors jeeta ${myFinal}-${oppFinal}!`;
      else if (myFinal < oppFinal) {
        const oppName = game.inviterId === myId ? (game.acceptorName||"Opponent") : (game.inviterName||"Opponent");
        resultMsg = `🏆 ${oppName} ne Rock Paper Scissors jeeta ${oppFinal}-${myFinal}!`;
      } else {
        resultMsg = `🤝 Rock Paper Scissors mein Draw! ${myFinal}-${oppFinal}`;
      }
      notifyGameResult(game.chatId, game.chatType, resultMsg);
    } else {
      updates.round = newRound;
    }
  }

  await update(ref(_db, `games/${gameId}`), updates);
};

window.nextRPSRound = async function(gameId) {
  await update(ref(_db, `games/${gameId}`), {
    currentChoices: {},
    roundResult:    null,
    roundReveal:    false,
  });
};

function getRPSResult(my, opp) {
  if (my === opp) return "draw";
  if ((my==="rock"&&opp==="scissors") || (my==="scissors"&&opp==="paper") || (my==="paper"&&opp==="rock")) return "win";
  return "lose";
}

// ─────────────────────────────────────────────────────────
//  NOTIFY RESULT IN CHAT
// ─────────────────────────────────────────────────────────
async function notifyGameResult(chatId, chatType, resultText) {
  const msgKey = push(ref(_db, `messages/${chatId}`)).key;
  const ts     = Date.now();
  await set(ref(_db, `messages/${chatId}/${msgKey}`), {
    type:       "game_result",
    text:       resultText,
    senderId:   "SYSTEM",
    senderName: "BhaiChara Games",
    timestamp:  ts,
    status:     "sent",
  });

  const membersSnap = await get(ref(_db, chatType === "group"
    ? `groups/${chatId}/members`
    : `chats/${chatId}/members`));
  const members = membersSnap.val() || [];
  for (const mId of members) {
    await update(ref(_db, `user_chats/${mId}/${chatId}`), {
      lastMessage:     `🎮 ${resultText}`,
      lastMessageTime: ts,
    });
  }
}

// ─────────────────────────────────────────────────────────
//  BUILD GAME INVITE MESSAGE ELEMENT
//  (app.js ke buildMessageEl mein call hoga)
// ─────────────────────────────────────────────────────────
export function buildGameMessageEl(msg, currentUser) {
  const div = document.createElement("div");
  div.className = `message ${msg.senderId === currentUser.uid ? "outgoing" : "incoming"}`;
  const isOut = msg.senderId === currentUser.uid;

  if (msg.type === "game_result") {
    div.innerHTML = `
      <div class="game-result-bubble">
        <span>${msg.text}</span>
        <span class="msg-time">${_fmtTime(msg.timestamp)}</span>
      </div>`;
    return div;
  }

  if (msg.type === "game_invite") {
    const gameName = msg.gameType === "ttt" ? "Tic-Tac-Toe ❌⭕" : "Rock Paper Scissors ✊✋✌️";
    const gameEmoji= msg.gameType === "ttt" ? "❌" : "✊";

    div.innerHTML = `
      <div class="game-invite-bubble ${isOut ? 'out' : 'in'}">
        <div class="gi-top">
          <span class="gi-emoji">${gameEmoji}</span>
          <div>
            <div class="gi-title">Game Invite 🎮</div>
            <div class="gi-game">${gameName}</div>
            <div class="gi-sender">${isOut ? "Tune invite kiya" : `${msg.senderName} ne invite kiya`}</div>
          </div>
        </div>
        ${!isOut ? `
          <div class="gi-actions">
            <button class="gi-accept" onclick="acceptGameInvite('${msg.gameId}')">Accept ✅</button>
            <button class="gi-decline" onclick="declineGameInvite('${msg.gameId}')">Decline ❌</button>
          </div>
        ` : `<div class="gi-waiting">⏳ Opponent ka wait ho raha hai...</div>`}
        <span class="msg-time gi-time">${_fmtTime(msg.timestamp)}</span>
      </div>`;

    // If already accepted, swap buttons
    getGameStatus(msg.gameId).then(status => {
      if (!status) return;
      const actionsEl = div.querySelector(".gi-actions");
      const waitEl    = div.querySelector(".gi-waiting");
      if (status === "active" || status === "finished") {
        if (actionsEl) actionsEl.innerHTML = `<button class="gi-accept" onclick="openGameBoard('${msg.gameId}','${msg.gameType}')">Open Game 🎮</button>`;
        if (waitEl)    waitEl.innerHTML    = `<button class="gi-accept" onclick="openGameBoard('${msg.gameId}','${msg.gameType}')">Open Game 🎮</button>`;
      } else if (status === "declined") {
        if (actionsEl) actionsEl.innerHTML = `<span style="color:var(--danger);font-size:0.8rem">Declined ❌</span>`;
      }
    });

    return div;
  }

  return div;
}

async function getGameStatus(gameId) {
  try {
    const snap = await get(ref(_db, `games/${gameId}/status`));
    return snap.val();
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────
function _fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts), now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", hour12:true })
    : d.toLocaleDateString("en-IN", { day:"numeric", month:"short" });
}

function showGameToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._gtimer);
  t._gtimer = setTimeout(() => t.classList.add("hidden"), 3000);
}
