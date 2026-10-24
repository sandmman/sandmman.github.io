/**
 * Extra Crazy 8s Pure Game Engine (Browser & Node Compatible)
 * Implements the Official Extra Crazy 8s Rules:
 *   - 1 standard 52-card deck (2-4p: 7 cards, 5p: 6, 6p: 5, 7-8p: 4)
 *   - Starter card does not trigger special effects; starter 8 uses natural suit
 *   - Multi-card same-rank plays (1st card matches top suit/rank or is 8)
 *   - Cross-turn & multi-card Consecutive-Denomination Streaks (3rd card -> first 2 draw 1 each;
 *     4th card -> first 3 draw 1 each; resets on rank change or stock reshuffle)
 *   - 8s Wild, 2s Draw-2 & Stacking (pre-draw stack or mid-draw/final-card drawn-2 intercept + hand 2s),
 *     7s Reverse (no skip in 2-player; verbal "reverse reverse"), Queens Skip (1 player per Queen)
 *   - Going Out & Final Round (0 cards is Temporarily Out; win when actual turn begins with 0 cards
 *     and 0 pending Draw-2 penalty; preceding player cannot voluntarily draw if holding a legal play)
 *   - Discord Audio Verbal Rules ("UNO" on 1 card, "reverse reverse" per 7, and Host Referee penalties
 *     scaling as 1 + turns_elapsed_since_turn_end)
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
  const SUIT_SORT_ORDER = { S: 0, H: 1, C: 2, D: 3 };
  const SUIT_NAMES = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
  const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const RANK_NAMES = {
    1: 'A',
    2: '2',
    3: '3',
    4: '4',
    5: '5',
    6: '6',
    7: '7',
    8: '8',
    9: '9',
    10: '10',
    11: 'J',
    12: 'Q',
    13: 'K',
  };

  function sortHand(hand) {
    if (!Array.isArray(hand)) return hand;
    hand.sort((a, b) => {
      const sDiff = (SUIT_SORT_ORDER[a.suit] ?? 9) - (SUIT_SORT_ORDER[b.suit] ?? 9);
      if (sDiff !== 0) return sDiff;
      return a.rank - b.rank;
    });
    return hand;
  }

  function cardLabel(card) {
    return `${RANK_NAMES[card.rank]}${SUIT_SYMBOLS[card.suit]}`;
  }

  function shuffle(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function createDeck(numDecks = 1) {
    const cards = [];
    for (let d = 0; d < numDecks; d++) {
      for (const s of SUITS) {
        for (let r = 1; r <= 13; r++) {
          cards.push({
            id: `${d}_${s}_${r}_${Math.random().toString(36).substr(2, 6)}`,
            suit: s,
            rank: r,
          });
        }
      }
    }
    return shuffle(cards);
  }

  function getCardsPerPlayer(numPlayers) {
    if (numPlayers <= 4) return 7;
    if (numPlayers === 5) return 6;
    if (numPlayers === 6) return 5;
    return 4; // 7-8 players
  }

  function createInitialVerbalState() {
    return {
      uno_vulnerable: false,
      reverse_vulnerable: false,
      sevens_played_count: 0,
      turns_elapsed_since_turn_end: 0,
    };
  }

  function createRoom(roomId, hostId, hostName) {
    return {
      room_id: roomId,
      status: 'LOBBY', // LOBBY | PLAYING | GAME_OVER
      game_number: 0,
      dealer_index: -1,
      direction: 1, // 1 = clockwise, -1 = counter-clockwise
      current_player_index: 0,
      phase: 'NORMAL_PLAY', // NORMAL_PLAY | DRAWING_PENALTY
      pending_two_penalty: 0,
      penalty_cards_drawn_this_turn: 0,
      last_drawn_card_id: null,
      active_suit: 'S',
      draw_pile: [],
      discard_pile: [],
      rank_streak: [], // Array of { card_id, rank, owner_id }
      final_round: false,
      players: [
        {
          id: hostId,
          name: hostName || 'Player 1',
          is_bot: false,
          hand: [],
          connected: true,
          verbal_state: createInitialVerbalState(),
        },
      ],
      winner_id: null,
      seq: 1,
      last_action: {
        seq: 1,
        type: 'ROOM_CREATED',
        actor_id: hostId,
        timestamp: Date.now(),
      },
      action_log: [`Room ${roomId} created by ${hostName || 'Player 1'}.`],
      updated_at: Date.now(),
    };
  }

  function addPlayer(room, playerId, playerName, isBot = false) {
    const existing = room.players.find((p) => p.id === playerId);
    if (existing) {
      existing.connected = true;
      if (playerName) existing.name = playerName;
      if (!existing.verbal_state) existing.verbal_state = createInitialVerbalState();
      return { ok: true, msg: 'Player reconnected.' };
    }

    let finalName = playerName ? playerName.trim() : '';
    if (!finalName || finalName === 'Player 1') {
      finalName = `Player ${room.players.length + 1}`;
    } else if (room.players.some((p) => p.name === finalName)) {
      finalName = `${finalName} (${room.players.length + 1})`;
    }

    if (room.status !== 'LOBBY' && !isBot) {
      const botSeat = room.players.find((p) => p.is_bot);
      if (botSeat) {
        const oldBotName = botSeat.name;
        botSeat.id = playerId;
        botSeat.name = finalName;
        botSeat.is_bot = false;
        botSeat.connected = true;
        botSeat.verbal_state = createInitialVerbalState();
        room.action_log.push(
          `${finalName} took over ${oldBotName}'s seat at the table!`
        );
        room.updated_at = Date.now();
        return { ok: true, msg: 'Player replaced bot in active game.' };
      }
      if (room.players.length < 8) {
        const cardsPerPlayer = getCardsPerPlayer(room.players.length + 1);
        const hand = [];
        for (let i = 0; i < cardsPerPlayer; i++) {
          const drawn = drawOneFromStock(room);
          if (drawn) hand.push(drawn);
        }
        sortHand(hand);
        room.players.push({
          id: playerId,
          name: finalName,
          is_bot: false,
          hand: hand,
          connected: true,
          verbal_state: createInitialVerbalState(),
        });
        room.action_log.push(
          `${finalName} joined the table mid-game (${room.players.length}/8).`
        );
        room.updated_at = Date.now();
        return { ok: true, msg: 'Player dealt into active game.' };
      }
      return { ok: false, error: 'Room is full (maximum 8 players).' };
    }

    if (room.status !== 'LOBBY') {
      return { ok: false, error: 'Game already in progress.' };
    }
    if (room.players.length >= 8) {
      return { ok: false, error: 'Room is full (maximum 8 players).' };
    }

    room.players.push({
      id: playerId,
      name: finalName,
      is_bot: isBot,
      hand: [],
      connected: true,
      verbal_state: createInitialVerbalState(),
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
    // Official Rules Section 9: Every denomination streak resets when play pile is shuffled
    room.rank_streak = [];
    room.action_log.push(
      '🔄 Reshuffled play pile into stock (all denomination streaks reset).'
    );
  }

  function drawOneFromStock(room) {
    if (room.draw_pile.length === 0) {
      reshuffleDiscardIntoDraw(room);
    }
    if (room.draw_pile.length === 0) return null;
    return room.draw_pile.pop();
  }

  function getPlayerCardCount(p) {
    if (!p) return 0;
    if (typeof p.card_count === 'number') return p.card_count;
    return Array.isArray(p.hand) ? p.hand.length : 0;
  }

  function updateFinalRoundFlag(room) {
    room.final_round = room.players.some((p) => getPlayerCardCount(p) === 0);
  }

  function isPlayerRestrictedFromVoluntaryDraw(room, playerIndex) {
    if (!room || !room.players || room.players.length < 2) return false;
    const numPlayers = room.players.length;
    const nextIdx = (playerIndex + room.direction + numPlayers * 10) % numPlayers;
    const nextPlayer = room.players[nextIdx];
    return Boolean(nextPlayer && getPlayerCardCount(nextPlayer) === 0);
  }

  function canInterceptWithDrawnTwo(room, player) {
    if (!room.last_drawn_card_id) return false;
    return player.hand.some(
      (c) => c.id === room.last_drawn_card_id && c.rank === 2
    );
  }

  function isCardPlayableInTurn(room, player, card) {
    if (!room || !player || !card) return false;
    if (room.phase === 'DRAWING_PENALTY') {
      if (room.penalty_cards_drawn_this_turn === 0) {
        return card.rank === 2;
      }
      return canInterceptWithDrawnTwo(room, player) && card.rank === 2;
    }
    // NORMAL_PLAY: If player already drew penalty cards this turn and did NOT draw a 2 on the final card,
    // pre-existing 2s from hand cannot be used as a delayed penalty interrupt
    if (
      room.penalty_cards_drawn_this_turn > 0 &&
      card.rank === 2 &&
      !canInterceptWithDrawnTwo(room, player)
    ) {
      return false;
    }
    const topCard = room.discard_pile[room.discard_pile.length - 1];
    if (!topCard) return true;
    return (
      card.rank === 8 ||
      card.rank === topCard.rank ||
      card.suit === room.active_suit
    );
  }

  function playerHasLegalPlay(room, player) {
    if (!player || !Array.isArray(player.hand)) return false;
    return player.hand.some((c) => isCardPlayableInTurn(room, player, c));
  }

  function startGame(room) {
    const numPlayers = room.players.length;
    if (numPlayers < 2 || numPlayers > 8) {
      return { ok: false, error: 'Need between 2 and 8 players to start.' };
    }

    // Official Rules Section 2: 1 standard 52-card deck; 2-4p: 7, 5p: 6, 6p: 5, 7-8p: 4
    const cardsPerPlayer = getCardsPerPlayer(numPlayers);
    const deck = createDeck(1);

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
    room.final_round = false;
    room.winner_id = null;

    // Deal cards 1 at a time starting to dealer's left
    room.players.forEach((p) => {
      p.hand = [];
      p.verbal_state = createInitialVerbalState();
    });
    for (let c = 0; c < cardsPerPlayer; c++) {
      for (let offset = 1; offset <= numPlayers; offset++) {
        const pIdx = (room.dealer_index + offset) % numPlayers;
        room.players[pIdx].hand.push(deck.pop());
      }
    }
    room.players.forEach((p) => sortHand(p.hand));

    // Starter card: does NOT activate special effects; if 8, natural suit is active
    const starter = deck.pop();
    room.draw_pile = deck;
    room.discard_pile = [starter];
    room.active_suit = starter.suit;
    room.rank_streak = [
      { card_id: starter.id, rank: starter.rank, owner_id: null },
    ];

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
      `--- Game #${room.game_number} Started! Dealer: ${dealerName} (${cardsPerPlayer} cards each, 52-card deck) ---`
    );
    room.action_log.push(
      `Starter card is ${cardLabel(starter)} (${SUIT_NAMES[starter.suit]}). ${starterName} plays first.`
    );
    room.updated_at = Date.now();
    return { ok: true, msg: 'Game started.' };
  }

  function advanceTurn(room, steps = 1) {
    const numPlayers = room.players.length;
    const prevPlayer = room.players[room.current_player_index];

    // Increment turns_elapsed_since_turn_end for all OTHER players who have an open verbal vulnerability window
    room.players.forEach((p) => {
      if (
        prevPlayer &&
        p.id !== prevPlayer.id &&
        p.verbal_state &&
        (p.verbal_state.uno_vulnerable || p.verbal_state.reverse_vulnerable)
      ) {
        p.verbal_state.turns_elapsed_since_turn_end += 1;
      }
    });

    room.current_player_index =
      (room.current_player_index + steps * room.direction + numPlayers * 10) %
      numPlayers;
    room.phase = room.pending_two_penalty === 0 ? 'NORMAL_PLAY' : 'DRAWING_PENALTY';
    room.penalty_cards_drawn_this_turn = 0;
    room.last_drawn_card_id = null;

    const nextPlayer = room.players[room.current_player_index];

    // Official Rules Sections 6 & 7: Verbal violation expires when the offending player's next turn begins
    if (nextPlayer && nextPlayer.verbal_state && steps > 0) {
      nextPlayer.verbal_state.uno_vulnerable = false;
      nextPlayer.verbal_state.reverse_vulnerable = false;
      nextPlayer.verbal_state.sevens_played_count = 0;
      nextPlayer.verbal_state.turns_elapsed_since_turn_end = 0;
    }

    updateFinalRoundFlag(room);

    // Official Rules Section 1 & Section 8:
    // A temporarily-out player wins ONLY when an actual turn begins for them and they still have 0 cards
    // (and no Draw-2 penalty obligation forcing them to draw at the start of their turn).
    if (nextPlayer && nextPlayer.hand.length === 0) {
      if (room.pending_two_penalty === 0) {
        room.status = 'GAME_OVER';
        room.winner_id = nextPlayer.id;
        room.final_round = false;
        room.seq = (room.seq || 0) + 1;
        room.last_action = {
          ...(room.last_action || {}),
          seq: room.seq,
          type: 'WIN',
          winner_id: nextPlayer.id,
          winner_name: nextPlayer.name,
          timestamp: Date.now(),
        };
        room.action_log.push(
          `🏆 ${nextPlayer.name}'s turn began with 0 cards — ${nextPlayer.name} OFFICIALLY WINS Game #${room.game_number}!`
        );
      } else {
        room.action_log.push(
          `😱 ${nextPlayer.name} had 0 cards, but must draw +${room.pending_two_penalty} from the Draw-2 penalty and is BACK IN THE GAME!`
        );
      }
    }
  }

  function resolveConsecutiveStreakForCard(room, card, actorPlayer, splashTargetIds) {
    if (
      !Array.isArray(room.rank_streak) ||
      room.rank_streak.length === 0 ||
      room.rank_streak[0].rank !== card.rank
    ) {
      room.rank_streak = [
        { card_id: card.id, rank: card.rank, owner_id: actorPlayer.id },
      ];
      return;
    }

    room.rank_streak.push({
      card_id: card.id,
      rank: card.rank,
      owner_id: actorPlayer.id,
    });

    const streakLen = room.rank_streak.length;
    // Official Rules Section 5:
    // 3rd consecutive card -> contributors of first 2 cards each draw 1 per card contributed
    // 4th consecutive card -> contributors of first 3 cards each draw 1 per card contributed
    if (streakLen === 3 || streakLen === 4) {
      const contributorsCount = streakLen - 1; // 2 for 3rd card, 3 for 4th card
      const contributingEntries = room.rank_streak.slice(0, contributorsCount);
      const drawSummaryByPlayer = new Map();

      contributingEntries.forEach((entry) => {
        if (!entry.owner_id) return;
        const targetPlayer = room.players.find((p) => p.id === entry.owner_id);
        if (!targetPlayer) return;
        const wasZero = targetPlayer.hand.length === 0;
        const drawn = drawOneFromStock(room);
        if (drawn) {
          targetPlayer.hand.push(drawn);
          sortHand(targetPlayer.hand);
          splashTargetIds.push(targetPlayer.id);
          drawSummaryByPlayer.set(
            targetPlayer.name,
            (drawSummaryByPlayer.get(targetPlayer.name) || 0) + 1
          );
          if (wasZero) {
            room.action_log.push(
              `😱 ${targetPlayer.name} was temporarily out (0 cards) and was pulled BACK INTO THE GAME by the ${streakLen}-card streak!`
            );
          }
        }
      });

      if (drawSummaryByPlayer.size > 0) {
        const parts = [];
        drawSummaryByPlayer.forEach((cnt, pName) => {
          parts.push(`${pName} (+${cnt})`);
        });
        room.action_log.push(
          `⚡ ${streakLen}-of-a-Kind Streak (${RANK_NAMES[card.rank]}s)! Earlier contributors draw: ${parts.join(', ')}.`
        );
      }
    }
  }

  function playCards(room, playerId, cardIds, chosenSuit = null) {
    if (room.status !== 'PLAYING') {
      return { ok: false, error: 'Game is not currently active.' };
    }

    const curIdx = room.current_player_index;
    const curPlayer = room.players[curIdx];
    if (curPlayer.id !== playerId) {
      return { ok: false, error: 'It is not your turn.' };
    }

    if (!cardIds || cardIds.length === 0) {
      return { ok: false, error: 'No cards selected to play.' };
    }

    // Validate ownership and preserve exact order played
    const handMap = {};
    curPlayer.hand.forEach((c) => {
      handMap[c.id] = c;
    });
    const selected = [];
    for (const cid of cardIds) {
      if (!handMap[cid]) {
        return { ok: false, error: 'Selected card is not in your hand.' };
      }
      selected.push(handMap[cid]);
    }

    // All played cards must share the same denomination (rank)
    const ranks = new Set(selected.map((c) => c.rank));
    if (ranks.size > 1) {
      return {
        ok: false,
        error: 'Multi-card plays must all share the same rank.',
      };
    }

    const rank = selected[0].rank;
    const k = selected.length;
    const topCard = room.discard_pile[room.discard_pile.length - 1];

    // Check if this is a Draw-2 stack or mid-draw/final-card interception
    const isInterceptingFinalDrawnTwo =
      room.phase === 'NORMAL_PLAY' &&
      room.penalty_cards_drawn_this_turn > 0 &&
      rank === 2 &&
      canInterceptWithDrawnTwo(room, curPlayer) &&
      cardIds.includes(room.last_drawn_card_id);

    if (room.phase === 'DRAWING_PENALTY') {
      if (rank !== 2) {
        return {
          ok: false,
          error: `You must draw ${room.pending_two_penalty} penalty card(s) or play a 2!`,
        };
      }
      if (room.penalty_cards_drawn_this_turn > 0) {
        if (!room.last_drawn_card_id || !cardIds.includes(room.last_drawn_card_id)) {
          return {
            ok: false,
            error:
              'Once you start drawing penalty cards, you can only intercept using a newly drawn 2 (optionally combined with other 2s in your hand)!',
          };
        }
      }
    } else {
      // Phase === NORMAL_PLAY
      if (
        room.penalty_cards_drawn_this_turn > 0 &&
        rank === 2 &&
        !isInterceptingFinalDrawnTwo
      ) {
        return {
          ok: false,
          error:
            'After drawing penalty cards, you cannot play a 2 that was already in your hand unless combined with a newly drawn 2.',
        };
      }
      const firstCard = selected[0];
      if (rank !== 8) {
        const matchesSuit = firstCard.suit === room.active_suit;
        const matchesRank = firstCard.rank === topCard.rank;
        if (!matchesSuit && !matchesRank) {
          return {
            ok: false,
            error: `First card (${cardLabel(firstCard)}) must match active suit (${SUIT_NAMES[room.active_suit]}) or top rank (${RANK_NAMES[topCard.rank]}).`,
          };
        }
      }
    }

    if (rank === 8) {
      if (!chosenSuit || !SUITS.includes(chosenSuit)) {
        chosenSuit = selected[selected.length - 1].suit;
      }
    }

    // Clear player's old verbal vulnerability window at start of their new play
    if (curPlayer.verbal_state) {
      curPlayer.verbal_state.uno_vulnerable = false;
      curPlayer.verbal_state.reverse_vulnerable = false;
      curPlayer.verbal_state.sevens_played_count = 0;
      curPlayer.verbal_state.turns_elapsed_since_turn_end = 0;
    }

    const wasMidDrawIntercept =
      (room.phase === 'DRAWING_PENALTY' && room.penalty_cards_drawn_this_turn > 0) ||
      isInterceptingFinalDrawnTwo;
    const wasPreDrawStack =
      room.phase === 'DRAWING_PENALTY' && room.penalty_cards_drawn_this_turn === 0;

    // -----------------------------------------------------------------
    // TIMING & PRIORITY (Official Rules Section 10)
    // 1. Complete the current player's legal card play
    // -----------------------------------------------------------------
    const idSet = new Set(cardIds);
    curPlayer.hand = curPlayer.hand.filter((c) => !idSet.has(c.id));
    sortHand(curPlayer.hand);
    room.discard_pile.push(...selected);
    room.active_suit = rank === 8 ? chosenSuit : selected[selected.length - 1].suit;

    const cardsStr = selected.map(cardLabel).join(', ');
    room.action_log.push(`${curPlayer.name} played ${cardsStr}.`);

    // -----------------------------------------------------------------
    // 2. Resolve any 3-card or 4-card denomination-streak penalties
    // -----------------------------------------------------------------
    const splashTargetIds = [];
    selected.forEach((c) => {
      resolveConsecutiveStreakForCard(room, c, curPlayer, splashTargetIds);
    });

    // -----------------------------------------------------------------
    // 3. Apply special-card effects (+2 obligation, 7 reverse, Queen skip)
    // -----------------------------------------------------------------
    let steps = 1;
    let actionType = 'PLAY';

    if (rank === 8) {
      actionType = 'WILD';
      room.action_log.push(
        `🎨 ${curPlayer.name} declared ${SUIT_NAMES[chosenSuit]} ${SUIT_SYMBOLS[chosenSuit]}!`
      );
    } else if (rank === 2) {
      room.pending_two_penalty += 2 * k;
      if (wasMidDrawIntercept) {
        actionType = 'INTERCEPT_TWO';
        room.action_log.push(
          `⚡ INTERCEPTION! ${curPlayer.name} played ${cardsStr} mid-draw! Next player now owes ${room.pending_two_penalty} cards!`
        );
      } else if (wasPreDrawStack) {
        actionType = 'STACK_TWO';
        room.action_log.push(
          `🔥 ${curPlayer.name} stacked ${cardsStr}! Penalty is now +${room.pending_two_penalty}!`
        );
      } else {
        actionType = 'STACK_TWO';
        room.action_log.push(
          `💥 +${2 * k} penalty active (Total: ${room.pending_two_penalty}) for the next player!`
        );
      }
    } else if (rank === 7) {
      actionType = 'REVERSE';
      if (k % 2 === 1) {
        room.direction *= -1;
        const dirName = room.direction === 1 ? 'Clockwise ↻' : 'Counter-Clockwise ↺';
        if (room.players.length === 2) {
          room.action_log.push(
            `🔄 ${curPlayer.name} played ${k}x 7 (Direction: ${dirName}; in 2-player, opponent still plays next — must say "reverse reverse"!).`
          );
        } else {
          room.action_log.push(`🔄 Direction reversed to ${dirName}!`);
        }
      } else {
        room.action_log.push(
          `🔄 ${k}x 7s played — direction reversed ${k} times (stays unchanged — must say "reverse reverse" ${k}x!).`
        );
      }
    } else if (rank === 12) {
      // Official Rules Section 6: Queens — Skip (1 player skipped per Queen)
      actionType = 'SKIP';
      steps = k + 1;
      const skippedNames = [];
      const numPlayers = room.players.length;
      for (let s = 1; s <= k; s++) {
        const skIdx =
          (room.current_player_index + s * room.direction + numPlayers * 10) %
          numPlayers;
        skippedNames.push(room.players[skIdx].name);
      }
      room.action_log.push(
        `⏭️ ${k}x Queen(s) played! Skipped: ${skippedNames.join(', ')}.`
      );
    }

    // Track Discord Verbal Rules Vulnerability Windows (Sections 6 & 7)
    if (curPlayer.verbal_state) {
      if (rank === 7) {
        curPlayer.verbal_state.reverse_vulnerable = true;
        curPlayer.verbal_state.sevens_played_count = k;
        curPlayer.verbal_state.turns_elapsed_since_turn_end = 0;
      }
      if (curPlayer.hand.length === 1) {
        curPlayer.verbal_state.uno_vulnerable = true;
        curPlayer.verbal_state.turns_elapsed_since_turn_end = 0;
      }
    }

    // Check if curPlayer is now Temporarily Out (0 cards -> Final Round)
    if (curPlayer.hand.length === 0) {
      room.action_log.push(
        `🚨 ${curPlayer.name} played their final card and is TEMPORARILY OUT (0 cards)! Final Round begins — ${curPlayer.name} wins if their next actual turn begins with 0 cards!`
      );
    }

    room.seq = (room.seq || 0) + 1;
    room.last_action = {
      seq: room.seq,
      type: actionType,
      actor_id: playerId,
      actor_name: curPlayer.name,
      cards: selected,
      chosen_suit: room.active_suit,
      splash_target_ids: splashTargetIds,
      timestamp: Date.now(),
    };

    // -----------------------------------------------------------------
    // 4. Proceed to the next eligible player in the resulting direction
    // -----------------------------------------------------------------
    advanceTurn(room, steps);
    room.updated_at = Date.now();
    return { ok: true, msg: 'Cards played.' };
  }

  function drawCard(room, playerId) {
    if (room.status !== 'PLAYING') {
      return { ok: false, error: 'Game is not active.', card: null };
    }

    const curIdx = room.current_player_index;
    const curPlayer = room.players[curIdx];
    if (curPlayer.id !== playerId) {
      return { ok: false, error: 'It is not your turn.', card: null };
    }

    // Official Rules Section 8: Final-Player Drawing Restriction
    if (
      room.phase === 'NORMAL_PLAY' &&
      isPlayerRestrictedFromVoluntaryDraw(room, curIdx) &&
      playerHasLegalPlay(room, curPlayer)
    ) {
      return {
        ok: false,
        error:
          'Final-Round Restriction: The next player has 0 cards and you already have a legal play! You must play a card and may not voluntarily draw.',
        card: null,
      };
    }

    const drawn = drawOneFromStock(room);
    if (!drawn) {
      return { ok: false, error: 'No cards left in stock or play pile!', card: null };
    }

    curPlayer.hand.push(drawn);
    sortHand(curPlayer.hand);
    room.last_drawn_card_id = drawn.id;

    // If curPlayer had 1 card and drew, they no longer have 1 card
    if (curPlayer.verbal_state && curPlayer.hand.length !== 1) {
      curPlayer.verbal_state.uno_vulnerable = false;
    }

    room.seq = (room.seq || 0) + 1;
    room.last_action = {
      seq: room.seq,
      type: 'DRAW',
      actor_id: playerId,
      actor_name: curPlayer.name,
      count: 1,
      card: drawn,
      drawn_cards: [drawn],
      timestamp: Date.now(),
    };

    if (room.phase === 'DRAWING_PENALTY') {
      room.pending_two_penalty -= 1;
      room.penalty_cards_drawn_this_turn += 1;
      room.action_log.push(
        `${curPlayer.name} drew 1 penalty card (${room.pending_two_penalty} remaining).`
      );

      if (drawn.rank === 2) {
        if (room.pending_two_penalty === 0) {
          room.phase = 'NORMAL_PLAY';
          room.action_log.push(
            `✨ ${curPlayer.name} drew a 2 on the final penalty card! They may immediately play it (with any other 2s) to pass a new +2 penalty, or play their normal turn.`
          );
        }
        updateFinalRoundFlag(room);
        room.updated_at = Date.now();
        return {
          ok: true,
          msg: 'Drew a 2! You can intercept and play it now!',
          card: drawn,
          canIntercept: true,
        };
      }

      if (room.pending_two_penalty === 0) {
        room.phase = 'NORMAL_PLAY';
        room.action_log.push(
          `${curPlayer.name} finished drawing the penalty and may now take their normal turn.`
        );
      }
      updateFinalRoundFlag(room);
      room.updated_at = Date.now();
      return { ok: true, msg: 'Penalty card drawn.', card: drawn, canIntercept: false };
    }

    room.action_log.push(`${curPlayer.name} drew a card.`);
    updateFinalRoundFlag(room);
    room.updated_at = Date.now();
    return { ok: true, msg: 'Card drawn.', card: drawn, canIntercept: false };
  }

  function drawUntilPlayable(room, playerId) {
    if (room.status !== 'PLAYING') {
      return { ok: false, error: 'Game is not active.', drawnCards: [] };
    }
    const curIdx = room.current_player_index;
    const curPlayer = room.players[curIdx];
    if (curPlayer.id !== playerId) {
      return { ok: false, error: 'It is not your turn.', drawnCards: [] };
    }
    if (room.phase === 'DRAWING_PENALTY') {
      return {
        ok: false,
        error: 'During +2 penalty, draw one card at a time to check for 2 interceptions.',
        drawnCards: [],
      };
    }

    if (
      isPlayerRestrictedFromVoluntaryDraw(room, curIdx) &&
      playerHasLegalPlay(room, curPlayer)
    ) {
      return {
        ok: false,
        error:
          'Final-Round Restriction: You already have a legal play and cannot voluntarily draw before a 0-card player!',
        drawnCards: [],
      };
    }

    const drawnCards = [];
    while (!playerHasLegalPlay(room, curPlayer)) {
      const drawn = drawOneFromStock(room);
      if (!drawn) break;
      curPlayer.hand.push(drawn);
      drawnCards.push(drawn);
      room.last_drawn_card_id = drawn.id;
    }
    sortHand(curPlayer.hand);

    if (drawnCards.length > 0) {
      room.seq = (room.seq || 0) + 1;
      room.last_action = {
        seq: room.seq,
        type: 'DRAW_UNTIL',
        actor_id: playerId,
        actor_name: curPlayer.name,
        count: drawnCards.length,
        drawn_cards: drawnCards,
        timestamp: Date.now(),
      };
      room.action_log.push(
        `${curPlayer.name} drew ${drawnCards.length} card(s) until playable.`
      );
    }
    updateFinalRoundFlag(room);
    room.updated_at = Date.now();
    return { ok: true, msg: `Drew ${drawnCards.length} card(s).`, drawnCards };
  }

  function applyVerbalPenalty(room, targetPlayerId, reason = 'CUSTOM_VERBAL', explicitCount = null) {
    if (!room || !room.players) {
      return { ok: false, error: 'Invalid room.' };
    }
    const target = room.players.find((p) => p.id === targetPlayerId);
    if (!target) {
      return { ok: false, error: 'Target player not found.' };
    }

    const vState = target.verbal_state || createInitialVerbalState();
    const turnsElapsed = Math.max(0, vState.turns_elapsed_since_turn_end || 0);
    let count = explicitCount;
    let reasonLabel = reason;

    if (reason === 'MISSED_UNO') {
      count = explicitCount && explicitCount > 0 ? explicitCount : 1 + turnsElapsed;
      reasonLabel = `Missed "UNO" (1 + ${turnsElapsed} turn${turnsElapsed === 1 ? '' : 's'})`;
      vState.uno_vulnerable = false;
    } else if (reason === 'MISSED_REVERSE') {
      count = explicitCount && explicitCount > 0 ? explicitCount : 1 + turnsElapsed;
      reasonLabel = `Missed "Reverse Reverse" (1 + ${turnsElapsed} turn${turnsElapsed === 1 ? '' : 's'})`;
      vState.reverse_vulnerable = false;
      vState.sevens_played_count = 0;
    } else {
      count = explicitCount && explicitCount > 0 ? explicitCount : 1;
      reasonLabel = reason || 'Discord Verbal Rule Violation';
    }

    if (!vState.uno_vulnerable && !vState.reverse_vulnerable) {
      vState.turns_elapsed_since_turn_end = 0;
    }
    target.verbal_state = vState;

    const wasZeroCards = target.hand.length === 0;
    if (room.status === 'GAME_OVER' && room.winner_id === target.id) {
      room.status = 'PLAYING';
      room.winner_id = null;
    }

    const drawnCards = [];
    for (let i = 0; i < count; i++) {
      const c = drawOneFromStock(room);
      if (c) {
        target.hand.push(c);
        drawnCards.push(c);
      }
    }
    sortHand(target.hand);

    updateFinalRoundFlag(room);

    room.seq = (room.seq || 0) + 1;
    room.last_action = {
      seq: room.seq,
      type: 'VERBAL_PENALTY',
      actor_id: room.players[0].id,
      target_id: target.id,
      target_name: target.name,
      reason: reason,
      reason_label: reasonLabel,
      count: drawnCards.length,
      drawn_cards: drawnCards,
      turns_elapsed: turnsElapsed,
      reinstated_from_zero: wasZeroCards,
      timestamp: Date.now(),
    };

    if (wasZeroCards && drawnCards.length > 0) {
      room.action_log.push(
        `📣 REFEREE WHISTLE! ${target.name} penalized +${drawnCards.length} card(s) (${reasonLabel}) and is PULLED BACK INTO THE GAME from 0 cards!`
      );
    } else {
      room.action_log.push(
        `📣 REFEREE WHISTLE! ${target.name} draws +${drawnCards.length} penalty card(s) (${reasonLabel}).`
      );
    }

    room.updated_at = Date.now();
    return { ok: true, msg: 'Verbal penalty applied.', count: drawnCards.length };
  }

  function chooseSuit(room, playerId, suit) {
    if (!SUITS.includes(suit)) return { ok: false, error: 'Invalid suit.' };
    room.active_suit = suit;
    room.updated_at = Date.now();
    return { ok: true, msg: `Suit set to ${suit}.` };
  }

  function getPublicRoomState(room, viewerPlayerId) {
    const clone = JSON.parse(JSON.stringify(room));
    clone.draw_pile_count = clone.draw_pile.length;
    delete clone.draw_pile;

    if (
      clone.last_action &&
      clone.last_action.actor_id !== viewerPlayerId &&
      clone.last_action.target_id !== viewerPlayerId
    ) {
      delete clone.last_action.card;
      delete clone.last_action.drawn_cards;
    }

    clone.players.forEach((p) => {
      p.card_count = p.hand.length;
      p.is_temporarily_out = p.hand.length === 0 && clone.status === 'PLAYING';
      if (p.id !== viewerPlayerId) {
        p.hand = [];
      }
    });
    return clone;
  }

  function planBotAction(room) {
    if (room.status !== 'PLAYING') return null;
    const curPlayer = room.players[room.current_player_index];
    if (!curPlayer || !curPlayer.is_bot) return null;

    const hand = curPlayer.hand;
    const topCard = room.discard_pile[room.discard_pile.length - 1];
    const activeSuit = room.active_suit;

    // 1. Handle +2 Penalty Phase
    if (room.phase === 'DRAWING_PENALTY') {
      if (room.penalty_cards_drawn_this_turn === 0) {
        const twos = hand.filter((c) => c.rank === 2);
        if (twos.length > 0) {
          return {
            action: 'playCards',
            cardIds: twos.map((c) => c.id),
            chosenSuit: null,
            target: 'discard',
          };
        }
      } else if (canInterceptWithDrawnTwo(room, curPlayer)) {
        const twos = hand.filter((c) => c.rank === 2);
        return {
          action: 'playCards',
          cardIds: twos.map((c) => c.id),
          chosenSuit: null,
          target: 'discard',
        };
      }
      return { action: 'drawCard', target: 'draw' };
    }

    // 2. Normal Play Phase: Group by rank
    const byRank = {};
    hand.forEach((c) => {
      if (!byRank[c.rank]) byRank[c.rank] = [];
      byRank[c.rank].push(c);
    });

    const nonEightRanks = Object.keys(byRank)
      .map(Number)
      .filter((r) => r !== 8);
    nonEightRanks.sort((a, b) => byRank[b].length - byRank[a].length);

    for (const r of nonEightRanks) {
      if (
        room.penalty_cards_drawn_this_turn > 0 &&
        r === 2 &&
        !canInterceptWithDrawnTwo(room, curPlayer)
      ) {
        continue;
      }
      const group = byRank[r];
      const matchIdx = group.findIndex(
        (c) => c.suit === activeSuit || c.rank === topCard.rank
      );
      if (matchIdx !== -1) {
        const ordered = [
          group[matchIdx],
          ...group.filter((_, i) => i !== matchIdx),
        ];
        // Avoid self-inflicted 3-card/4-card streak penalty unless bot can shed multiple cards advantageously
        return {
          action: 'playCards',
          cardIds: ordered.map((c) => c.id),
          chosenSuit: null,
          target: 'discard',
        };
      }
    }

    if (byRank[8] && byRank[8].length > 0) {
      const suitCounts = { S: 0, H: 0, D: 0, C: 0 };
      hand.forEach((c) => {
        if (c.rank !== 8) suitCounts[c.suit] += 1;
      });
      const bestSuit = Object.keys(suitCounts).reduce((a, b) =>
        suitCounts[a] >= suitCounts[b] ? a : b
      );
      return {
        action: 'playCards',
        cardIds: [byRank[8][0].id],
        chosenSuit: bestSuit,
        target: 'discard',
      };
    }

    return { action: 'drawCard', target: 'draw' };
  }

  function executeBotTurn(room) {
    const plan = planBotAction(room);
    if (!plan) return false;
    const curPlayer = room.players[room.current_player_index];

    if (plan.action === 'playCards') {
      playCards(room, curPlayer.id, plan.cardIds, plan.chosenSuit);
      // Bots automatically say UNO and "reverse reverse" unless we want them to be infallible
      if (curPlayer.verbal_state) {
        curPlayer.verbal_state.uno_vulnerable = false;
        curPlayer.verbal_state.reverse_vulnerable = false;
      }
      return true;
    } else if (plan.action === 'drawCard') {
      if (room.phase === 'DRAWING_PENALTY') {
        drawCard(room, curPlayer.id);
      } else {
        drawUntilPlayable(room, curPlayer.id);
        const followUp = planBotAction(room);
        if (followUp && followUp.action === 'playCards') {
          playCards(room, curPlayer.id, followUp.cardIds, followUp.chosenSuit);
          if (curPlayer.verbal_state) {
            curPlayer.verbal_state.uno_vulnerable = false;
            curPlayer.verbal_state.reverse_vulnerable = false;
          }
        } else if (room.status === 'PLAYING') {
          advanceTurn(room, 1);
        }
      }
      return true;
    }
    return false;
  }

  return {
    SUITS,
    SUIT_SORT_ORDER,
    SUIT_NAMES,
    SUIT_SYMBOLS,
    RANK_NAMES,
    sortHand,
    cardLabel,
    getCardsPerPlayer,
    isCardPlayableInTurn,
    playerHasLegalPlay,
    isPlayerRestrictedFromVoluntaryDraw,
    createRoom,
    addPlayer,
    removePlayer,
    startGame,
    playCards,
    drawCard,
    drawUntilPlayable,
    applyVerbalPenalty,
    chooseSuit,
    getPublicRoomState,
    planBotAction,
    executeBotTurn,
  };
});
