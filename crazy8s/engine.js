/**
 * Crazy 8s Authoritative Game Engine (Client & Host-Tab Engine)
 * Exposes window.Crazy8Engine
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Crazy8Engine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['S', 'H', 'D', 'C'];
  const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_NAMES = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
  const RANK_LABELS = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

  function getRankStr(rank) {
    return RANK_LABELS[rank] || String(rank);
  }

  function getCardDisplay(card) {
    return `${getRankStr(card.rank)}${SUIT_SYMBOLS[card.suit] || card.suit}`;
  }

  function createDeck(count) {
    const deck = [];
    for (let d = 1; d <= count; d++) {
      for (const suit of SUITS) {
        for (let rank = 1; rank <= 13; rank++) {
          deck.push({
            id: `d${d}-${suit}-${rank}`,
            suit: suit,
            rank: rank,
            deck_num: d,
          });
        }
      }
    }
    return shuffle(deck);
  }

  function shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  }

  function createRoom(roomId, hostId, hostName) {
    return {
      room_id: roomId,
      status: 'LOBBY', // LOBBY, PLAYING, GAME_OVER
      game_number: 0,
      dealer_index: -1,
      current_player_index: 0,
      direction: 1, // 1: clockwise, -1: counter-clockwise
      phase: 'NORMAL_PLAY', // NORMAL_PLAY, DRAWING_PENALTY
      draw_pile: [],
      discard_pile: [],
      active_suit: 'S',
      pending_two_penalty: 0,
      penalty_cards_drawn_this_turn: 0,
      last_drawn_card_id: null,
      winner_id: null,
      seq: 1,
      last_action: {
        seq: 1,
        type: 'ROOM_CREATED',
        actor_id: hostId,
        actor_name: hostName,
        timestamp: Date.now(),
      },
      players: [
        {
          id: hostId,
          name: hostName || 'Host',
          is_bot: false,
          hand: [],
          connected: true,
        },
      ],
      action_log: [`Room ${roomId} created by ${hostName || 'Host'}.`],
      created_at: Date.now(),
      updated_at: Date.now(),
    };
  }

  function addPlayer(room, playerId, playerName, isBot = false) {
    const existing = room.players.find((p) => p.id === playerId);
    if (existing) {
      existing.connected = true;
      if (playerName) existing.name = playerName;
      return { ok: true, msg: 'Player reconnected.' };
    }
    if (room.status !== 'LOBBY') {
      return { ok: false, error: 'Game already in progress.' };
    }
    if (room.players.length >= 8) {
      return { ok: false, error: 'Room is full (maximum 8 players).' };
    }

    // Disambiguate duplicate or generic default names
    let finalName = playerName ? playerName.trim() : '';
    if (!finalName || finalName === 'Player 1') {
      finalName = `Player ${room.players.length + 1}`;
    } else if (room.players.some((p) => p.name === finalName)) {
      finalName = `${finalName} (${room.players.length + 1})`;
    }

    room.players.push({
      id: playerId,
      name: finalName,
      is_bot: isBot,
      hand: [],
      connected: true,
    });
    room.action_log.push(
      `${finalName} joined the room (${room.players.length}/8).`
    );
    room.updated_at = Date.now();
    return { ok: true, msg: 'Player added.' };
  }

  function removePlayer(room, playerId) {
    if (room.status !== 'LOBBY') {
      const p = room.players.find((x) => x.id === playerId);
      if (p) {
        p.connected = false;
        room.updated_at = Date.now();
        return { ok: true, msg: 'Player marked disconnected.' };
      }
      return { ok: false, error: 'Player not found.' };
    }
    const initLen = room.players.length;
    room.players = room.players.filter((p) => p.id !== playerId);
    if (room.players.length < initLen) {
      room.updated_at = Date.now();
      return { ok: true, msg: 'Player removed.' };
    }
    return { ok: false, error: 'Player not found.' };
  }

  function reshuffleDiscardIntoDraw(room) {
    if (room.discard_pile.length <= 1) return;
    const top = room.discard_pile.pop();
    const rest = shuffle(room.discard_pile);
    room.draw_pile.push(...rest);
    room.discard_pile = [top];
    room.action_log.push('Reshuffled discard pile into draw pile.');
  }

  function startGame(room) {
    const numPlayers = room.players.length;
    if (numPlayers < 2 || numPlayers > 8) {
      return { ok: false, error: 'Need between 2 and 8 players to start.' };
    }

    const deckCount = numPlayers >= 5 ? 2 : 1;
    const cardsPerPlayer = numPlayers >= 5 ? 7 : 6;
    const deck = createDeck(deckCount);

    // Rotate dealer
    if (room.dealer_index === -1) {
      room.dealer_index = 0;
    } else {
      room.dealer_index = (room.dealer_index + 1) % numPlayers;
    }

    room.game_number += 1;
    room.status = 'PLAYING';
    room.direction = 1;
    room.current_player_index = (room.dealer_index + 1) % numPlayers;
    room.phase = 'NORMAL_PLAY';
    room.pending_two_penalty = 0;
    room.penalty_cards_drawn_this_turn = 0;
    room.last_drawn_card_id = null;
    room.winner_id = null;

    // Deal cards
    room.players.forEach((p) => {
      p.hand = [];
      for (let i = 0; i < cardsPerPlayer; i++) {
        p.hand.push(deck.pop());
      }
    });

    let starter = deck.pop();
    let attempts = 0;
    while ([8, 2, 7].includes(starter.rank) && deck.length > 0 && attempts < 12) {
      deck.unshift(starter);
      starter = deck.pop();
      attempts++;
    }

    room.draw_pile = deck;
    room.discard_pile = [starter];
    room.active_suit = starter.suit;

    const dealerName = room.players[room.dealer_index].name;
    const starterName = room.players[room.current_player_index].name;

    room.seq = (room.seq || 0) + 1;
    room.last_action = {
      seq: room.seq,
      type: 'DEAL',
      actor_id: room.players[room.dealer_index].id,
      actor_name: dealerName,
      cardsPerPlayer: cardsPerPlayer,
      starterCard: starter,
      timestamp: Date.now(),
    };

    room.action_log.push(
      `Game #${room.game_number} started! Dealer: ${dealerName}. Starter: ${getCardDisplay(starter)}. ${starterName} goes first.`
    );
    room.updated_at = Date.now();
    return { ok: true, msg: 'Game started.' };
  }

  function advanceTurn(room, steps = 1) {
    const numPlayers = room.players.length;
    room.current_player_index =
      (room.current_player_index + steps * room.direction + numPlayers * 10) %
      numPlayers;
    room.phase =
      room.pending_two_penalty === 0 ? 'NORMAL_PLAY' : 'DRAWING_PENALTY';
    room.penalty_cards_drawn_this_turn = 0;
    room.last_drawn_card_id = null;
  }

  function playCards(room, playerId, cardIds, chosenSuit = null) {
    if (room.status !== 'PLAYING') {
      return { ok: false, error: 'Game is not currently active.' };
    }
    const curPlayer = room.players[room.current_player_index];
    if (curPlayer.id !== playerId) {
      return { ok: false, error: 'It is not your turn.' };
    }
    if (!cardIds || cardIds.length === 0) {
      return { ok: false, error: 'No cards selected to play.' };
    }

    const handMap = new Map(curPlayer.hand.map((c) => [c.id, c]));
    const selected = [];
    for (const cid of cardIds) {
      if (!handMap.has(cid)) {
        return { ok: false, error: `Card ${cid} is not in your hand.` };
      }
      selected.push(handMap.get(cid));
    }

    const rank = selected[0].rank;
    if (selected.some((c) => c.rank !== rank)) {
      return { ok: false, error: 'All cards played together must have the same rank.' };
    }

    const topCard = room.discard_pile[room.discard_pile.length - 1];
    const activeSuit = room.active_suit;
    const k = selected.length;
    const numPlayers = room.players.length;

    // Penalty phase (facing +2)
    if (room.phase === 'DRAWING_PENALTY') {
      if (rank !== 2) {
        return { ok: false, error: 'Facing a +2 penalty! You may only play 2s to stack or intercept, or draw.' };
      }
      if (
        room.penalty_cards_drawn_this_turn > 0 &&
        !cardIds.includes(room.last_drawn_card_id)
      ) {
        return { ok: false, error: 'Must include the 2 you just drew to intercept mid-draw!' };
      }

      const isIntercept = room.penalty_cards_drawn_this_turn > 0;
      room.pending_two_penalty += 2 * k;

      curPlayer.hand = curPlayer.hand.filter((c) => !cardIds.includes(c.id));
      room.discard_pile.push(...selected);
      room.active_suit = selected[selected.length - 1].suit;

      room.seq = (room.seq || 0) + 1;
      room.last_action = {
        seq: room.seq,
        type: isIntercept ? 'INTERCEPT_TWO' : 'STACK_TWO',
        actor_id: curPlayer.id,
        actor_name: curPlayer.name,
        cards: selected,
        pendingPenalty: room.pending_two_penalty,
        timestamp: Date.now(),
      };

      room.action_log.push(
        `${curPlayer.name} ${isIntercept ? '⚡ INTERCEPTED with' : 'stacked'} ${k}x Two(s)! Total penalty is now +${room.pending_two_penalty}.`
      );

      if (curPlayer.hand.length === 0) {
        room.status = 'GAME_OVER';
        room.winner_id = curPlayer.id;
        room.last_action.type = 'WIN';
        room.action_log.push(`🎉 ${curPlayer.name} has 0 cards and WINS the game!`);
        room.updated_at = Date.now();
        return { ok: true, msg: 'Win! 0 cards.' };
      }

      advanceTurn(room, 1);
      room.updated_at = Date.now();
      return { ok: true, msg: `Stacked ${k} Two(s).` };
    }

    // Normal play phase
    if (rank !== topCard.rank && rank !== 8) {
      const matching = selected.filter((c) => c.suit === activeSuit);
      if (matching.length === 0) {
        return {
          ok: false,
          error: `Cannot play ${getCardDisplay(selected[0])} on ${getCardDisplay(topCard)} (Suit is ${SUIT_NAMES[activeSuit] || activeSuit}).`,
        };
      }
      // Reorder so suit-matching card goes down first
      if (selected[0].suit !== activeSuit) {
        const bridge = matching[0];
        const rest = selected.filter((c) => c.id !== bridge.id);
        selected.length = 0;
        selected.push(bridge, ...rest);
      }
    }

    let newSuit = selected[selected.length - 1].suit;
    if (rank === 8) {
      if (!chosenSuit || !SUITS.includes(chosenSuit)) {
        return { ok: false, error: 'Wild 8 played! You must choose a suit.' };
      }
      newSuit = chosenSuit;
    }

    curPlayer.hand = curPlayer.hand.filter((c) => !cardIds.includes(c.id));
    room.discard_pile.push(...selected);
    room.active_suit = newSuit;

    const cardsDesc = selected.map(getCardDisplay).join(', ');
    room.action_log.push(
      `${curPlayer.name} played ${cardsDesc}${rank === 8 ? ` (Suit: ${SUIT_NAMES[newSuit]})` : ''}.`
    );

    room.seq = (room.seq || 0) + 1;
    const actionType = rank === 8 ? 'WILD' : rank === 7 ? 'REVERSE' : rank === 2 ? 'STACK_TWO' : 'PLAY';
    room.last_action = {
      seq: room.seq,
      type: actionType,
      actor_id: curPlayer.id,
      actor_name: curPlayer.name,
      cards: selected,
      chosen_suit: chosenSuit,
      splash_target_ids: [],
      timestamp: Date.now(),
    };

    if (curPlayer.hand.length === 0) {
      room.status = 'GAME_OVER';
      room.winner_id = curPlayer.id;
      room.last_action.type = 'WIN';
      room.action_log.push(`🎉 ${curPlayer.name} has 0 cards and WINS the game!`);
      room.updated_at = Date.now();
      return { ok: true, msg: 'Win! 0 cards.' };
    }

    let steps = 1;
    if (rank === 7) {
      if (numPlayers === 2) {
        if (k % 2 === 1) {
          steps = 0; // Skip
          room.action_log.push(`7 in 2-player game acts as SKIP! ${curPlayer.name} goes again.`);
        } else {
          steps = 1;
        }
      } else {
        if (k % 2 === 1) {
          room.direction *= -1;
          const dirStr = room.direction === 1 ? 'Clockwise ↻' : 'Counter-Clockwise ↺';
          room.action_log.push(`Direction reversed by 7! Play proceeds ${dirStr}.`);
        }
      }
    }

    // n >= 3 Splash Draw
    if (k >= 3) {
      const splashCount = k - 1;
      room.action_log.push(`${k} matching cards! Next ${splashCount} player(s) draw 1 card each.`);
      for (let m = 1; m <= splashCount; m++) {
        const tIdx = (room.current_player_index + m * room.direction + numPlayers * 10) % numPlayers;
        const target = room.players[tIdx];
        if (room.draw_pile.length === 0) reshuffleDiscardIntoDraw(room);
        if (room.draw_pile.length > 0) {
          const drawn = room.draw_pile.pop();
          target.hand.push(drawn);
          room.last_action.splash_target_ids.push(target.id);
          room.action_log.push(`  ➜ ${target.name} drew 1 splash penalty card.`);
        }
      }
    }

    if (rank === 2) {
      room.pending_two_penalty += 2 * k;
      advanceTurn(room, steps);
      room.phase = 'DRAWING_PENALTY';
      room.updated_at = Date.now();
      return { ok: true, msg: `Played ${k} Two(s).` };
    }

    advanceTurn(room, steps);
    room.updated_at = Date.now();
    return { ok: true, msg: 'Cards played successfully.' };
  }

  function drawCard(room, playerId) {
    if (room.status !== 'PLAYING') {
      return { ok: false, error: 'Game is not active.', card: null };
    }
    const curPlayer = room.players[room.current_player_index];
    if (curPlayer.id !== playerId) {
      return { ok: false, error: 'It is not your turn.', card: null };
    }
    if (room.draw_pile.length === 0) {
      reshuffleDiscardIntoDraw(room);
    }
    if (room.draw_pile.length === 0) {
      if (room.phase === 'DRAWING_PENALTY') {
        room.pending_two_penalty = 0;
        room.phase = 'NORMAL_PLAY';
        return { ok: true, msg: 'Deck empty. Penalty cleared.', card: null };
      }
      return { ok: false, error: 'Draw and discard piles are empty!', card: null };
    }

    const drawn = room.draw_pile.pop();
    curPlayer.hand.push(drawn);

    room.seq = (room.seq || 0) + 1;
    room.last_action = {
      seq: room.seq,
      type: 'DRAW',
      actor_id: curPlayer.id,
      actor_name: curPlayer.name,
      card: drawn,
      timestamp: Date.now(),
    };

    if (room.phase === 'DRAWING_PENALTY') {
      room.pending_two_penalty -= 1;
      room.penalty_cards_drawn_this_turn += 1;
      room.last_drawn_card_id = drawn.id;

      if (drawn.rank === 2) {
        room.action_log.push(
          `${curPlayer.name} drew a TWO! They can INTERCEPT and play it, or keep drawing.`
        );
        room.updated_at = Date.now();
        return { ok: true, msg: 'Drew a 2! Can intercept now.', card: drawn, canIntercept: true };
      }

      room.action_log.push(
        `${curPlayer.name} drew 1 penalty card (${room.pending_two_penalty} remaining).`
      );

      if (room.pending_two_penalty === 0) {
        room.phase = 'NORMAL_PLAY';
        room.penalty_cards_drawn_this_turn = 0;
        room.last_drawn_card_id = null;
        room.action_log.push(`${curPlayer.name} finished penalty draw and may now take a regular turn.`);
      }

      room.updated_at = Date.now();
      return { ok: true, msg: 'Drew 1 penalty card.', card: drawn, canIntercept: false };
    }

    room.action_log.push(`${curPlayer.name} drew a card.`);
    room.updated_at = Date.now();
    return { ok: true, msg: 'Card drawn.', card: drawn, canIntercept: false };
  }

  function drawUntilPlayable(room, playerId) {
    if (room.status !== 'PLAYING') {
      return { ok: false, error: 'Game is not active.', drawnCards: [] };
    }
    const curPlayer = room.players[room.current_player_index];
    if (curPlayer.id !== playerId) {
      return { ok: false, error: 'It is not your turn.', drawnCards: [] };
    }
    if (room.phase === 'DRAWING_PENALTY') {
      return { ok: false, error: 'Cannot auto-draw during penalty (draw one-by-one to check for 2s).', drawnCards: [] };
    }

    const topCard = room.discard_pile[room.discard_pile.length - 1];
    const activeSuit = room.active_suit;
    const drawn = [];

    while (
      !curPlayer.hand.some(
        (c) => c.rank === 8 || c.rank === topCard.rank || c.suit === activeSuit
      )
    ) {
      if (room.draw_pile.length === 0) reshuffleDiscardIntoDraw(room);
      if (room.draw_pile.length === 0) break;
      const c = room.draw_pile.pop();
      curPlayer.hand.push(c);
      drawn.push(c);
    }

    room.seq = (room.seq || 0) + 1;
    room.last_action = {
      seq: room.seq,
      type: 'DRAW_UNTIL',
      actor_id: curPlayer.id,
      actor_name: curPlayer.name,
      count: drawn.length,
      timestamp: Date.now(),
    };

    room.action_log.push(`${curPlayer.name} drew ${drawn.length} card(s) until finding a playable card.`);
    room.updated_at = Date.now();
    return { ok: true, msg: `Drew ${drawn.length} cards.`, drawnCards: drawn };
  }

  function chooseSuit(room, playerId, suit) {
    if (!SUITS.includes(suit)) {
      return { ok: false, error: 'Invalid suit.' };
    }
    room.active_suit = suit;
    room.action_log.push(`Suit changed to ${SUIT_NAMES[suit]}.`);
    room.updated_at = Date.now();
    return { ok: true, msg: 'Suit updated.' };
  }

  function getPublicRoomState(room, playerId) {
    const copy = JSON.parse(JSON.stringify(room));
    copy.draw_pile_count = copy.draw_pile ? copy.draw_pile.length : 0;
    delete copy.draw_pile;
    copy.players.forEach((p) => {
      p.card_count = p.hand ? p.hand.length : 0;
      if (p.id !== playerId) {
        p.hand = []; // Hide other hands
      }
    });
    return copy;
  }

  /**
   * Plans bot action in advance so Host can broadcast simulated drag trajectory.
   */
  function planBotAction(room) {
    if (room.status !== 'PLAYING') return null;
    const curPlayer = room.players[room.current_player_index];
    if (!curPlayer || !curPlayer.is_bot) return null;

    const topCard = room.discard_pile[room.discard_pile.length - 1];
    const activeSuit = room.active_suit;
    const hand = curPlayer.hand;

    // Penalty phase
    if (room.phase === 'DRAWING_PENALTY') {
      const twos = hand.filter((c) => c.rank === 2);
      if (room.penalty_cards_drawn_this_turn === 0 && twos.length > 0) {
        return { action: 'play', cardIds: twos.map((c) => c.id), target: 'discard' };
      }
      if (
        room.last_drawn_card_id &&
        twos.some((c) => c.id === room.last_drawn_card_id)
      ) {
        return { action: 'play', cardIds: [room.last_drawn_card_id], target: 'discard' };
      }
      return { action: 'draw', target: 'draw_pile' };
    }

    // Normal play
    const byRank = {};
    hand.forEach((c) => {
      if (!byRank[c.rank]) byRank[c.rank] = [];
      byRank[c.rank].push(c);
    });

    let bestCombo = null;
    for (const [rStr, cards] of Object.entries(byRank)) {
      const r = parseInt(rStr, 10);
      if (r === 8) continue;
      if (r === topCard.rank || cards.some((c) => c.suit === activeSuit)) {
        if (!bestCombo || cards.length > bestCombo.length) {
          bestCombo = cards;
        }
      }
    }

    if (bestCombo) {
      return { action: 'play', cardIds: bestCombo.map((c) => c.id), target: 'discard' };
    }

    if (byRank[8]) {
      const nonEights = hand.filter((c) => c.rank !== 8);
      const suitCounts = {};
      nonEights.forEach((c) => {
        suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
      });
      let chosen = 'S';
      let maxCount = -1;
      for (const s of SUITS) {
        if ((suitCounts[s] || 0) > maxCount) {
          maxCount = suitCounts[s] || 0;
          chosen = s;
        }
      }
      return {
        action: 'play',
        cardIds: byRank[8].map((c) => c.id),
        chosenSuit: chosen,
        target: 'discard',
      };
    }

    return { action: 'draw', target: 'draw_pile' };
  }

  function executeBotTurn(room) {
    const plan = planBotAction(room);
    if (!plan) return { ok: false, error: 'No bot action planned.' };
    const curPlayer = room.players[room.current_player_index];

    if (plan.action === 'play') {
      return playCards(room, curPlayer.id, plan.cardIds, plan.chosenSuit);
    }
    return drawCard(room, curPlayer.id);
  }

  return {
    SUITS,
    SUIT_SYMBOLS,
    SUIT_NAMES,
    RANK_LABELS,
    getRankStr,
    getCardDisplay,
    createRoom,
    addPlayer,
    removePlayer,
    startGame,
    playCards,
    drawCard,
    drawUntilPlayable,
    chooseSuit,
    getPublicRoomState,
    planBotAction,
    executeBotTurn,
  };
});
