/**
 * Crazy 8s Tabletop UX & Interactive Card Physics Engine
 * Exposes window.Crazy8UX and window.Crazy8Audio
 */

(function (root, factory) {
  const mod = factory();
  root.Crazy8Audio = mod.Audio;
  root.Crazy8UX = mod.UX;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // -----------------------------------------------------------------
  // 1. PROCEDURAL WEBAUDIO SYNTHESIZER (Crazy8Audio)
  // -----------------------------------------------------------------

  class SoundSynthesizer {
    constructor() {
      this.ctx = null;
      this.muted = false;
    }

    _init() {
      if (!this.ctx && typeof AudioContext !== 'undefined') {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    setMuted(m) {
      this.muted = !!m;
    }

    play(soundName) {
      if (this.muted) return;
      this._init();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      try {
        switch (soundName) {
          case 'card_slide':
            this._noiseWhoosh(now, 0.08, 800, 1800, 0.15);
            break;
          case 'card_snap':
            this._cardSnap(now);
            break;
          case 'draw':
            this._toneSweep(now, 260, 520, 0.12, 'sine', 0.2);
            break;
          case 'reverse':
            this._chordSweep(now, [440, 554, 659], 0.25);
            break;
          case 'penalty_impact':
            this._bassDrop(now);
            break;
          case 'intercept':
            this._electricArp(now);
            break;
          case 'turn_chime':
            this._toneBell(now, 587.33); // D5
            break;
          case 'win':
            this._fanfare(now);
            break;
          case 'emote':
            this._toneSweep(now, 400, 750, 0.08, 'triangle', 0.15);
            break;
        }
      } catch (e) {
        console.warn('[Audio Error]:', e);
      }
    }

    _toneSweep(t, fStart, fEnd, dur, type = 'sine', vol = 0.2) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(fStart, t);
      osc.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
    }

    _cardSnap(t) {
      // High click + body impulse
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, t);
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.06);
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.06);
    }

    _noiseWhoosh(t, dur, fLow, fHigh, vol) {
      const bufferSize = this.ctx.sampleRate * dur;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(fLow, t);
      filter.frequency.exponentialRampToValueAtTime(fHigh, t + dur);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start(t);
      noise.stop(t + dur);
    }

    _bassDrop(t) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(35, t + 0.35);
      gain.gain.setValueAtTime(0.6, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.35);
    }

    _electricArp(t) {
      [659, 880, 1046, 1318].forEach((f, idx) => {
        const subT = t + idx * 0.04;
        this._toneSweep(subT, f, f * 1.2, 0.08, 'sine', 0.25);
      });
    }

    _toneBell(t, f) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    }

    _chordSweep(t, freqs, dur) {
      freqs.forEach((f) => {
        this._toneSweep(t, f, f * 1.5, dur, 'triangle', 0.18);
      });
    }

    _fanfare(t) {
      // C - E - G - High C progression
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, idx) => {
        const noteT = t + idx * 0.12;
        this._toneBell(noteT, f);
      });
    }
  }

  const audio = new SoundSynthesizer();

  // -----------------------------------------------------------------
  // 2. TABLETOP UX CONTROLLER (Crazy8UX)
  // -----------------------------------------------------------------

  const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const RANK_LABELS = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

  function getRankStr(r) {
    return RANK_LABELS[r] || String(r);
  }

  // Persistent pseudo-random scatter angles for the discard pile
  const discardAngleCache = new Map();

  function getCardScatter(cardId) {
    if (!discardAngleCache.has(cardId)) {
      const rot = (Math.random() * 24 - 12).toFixed(1); // -12deg to +12deg
      const ox = (Math.random() * 12 - 6).toFixed(1);
      const oy = (Math.random() * 12 - 6).toFixed(1);
      discardAngleCache.set(cardId, { rot, ox, oy });
    }
    return discardAngleCache.get(cardId);
  }

  // Active remote drag ghosts
  const remoteGhosts = new Map(); // senderId -> element

  class TabletopUX {
    constructor() {
      this.dragState = null;
      this.throttleTimer = null;
    }

    // -------------------------------------------------------------
    // INTERACTIVE PLAYER HAND (Curved Fan & Drag-and-Drop)
    // -------------------------------------------------------------

    renderInteractiveHand(hand, selectedCards, room, isMyTurn, onSelectCard, onPlaySelected, onDrawOne) {
      const track = document.getElementById('hand-fan-track');
      if (!track) return;
      track.innerHTML = '';

      const topCard = room.discard_pile[room.discard_pile.length - 1];
      const activeSuit = room.active_suit;
      const N = hand.length;
      const maxArcSpread = 42; // Max degrees fan
      const angleStep = N > 1 ? Math.min(6, maxArcSpread / (N - 1)) : 0;
      const xSpacing = N > 8 ? Math.max(34, 480 / N) : 58;

      hand.forEach((card, idx) => {
        const isPlayable =
          isMyTurn &&
          (room.phase === 'DRAWING_PENALTY'
            ? card.rank === 2
            : card.rank === 8 || card.rank === topCard.rank || card.suit === activeSuit);

        const selIdx = selectedCards.indexOf(card.id);
        const isSel = selIdx !== -1;
        const isRed = card.suit === 'H' || card.suit === 'D';

        // Fan geometry: rotation + parabolic arc offset
        const mid = (N - 1) / 2;
        const rot = (idx - mid) * angleStep;
        const xOffset = (idx - mid) * xSpacing;
        const yOffset = Math.pow(idx - mid, 2) * 2.2; // Parabola dip

        const wrap = document.createElement('div');
        wrap.className = `hand-card-wrapper ${isPlayable ? 'playable' : ''} ${isSel ? 'selected' : ''}`;
        wrap.dataset.cardId = card.id;
        wrap.style.transform = `translateX(${xOffset}px) translateY(${yOffset}px) rotate(${rot}deg)`;
        wrap.style.zIndex = 10 + idx;

        const r = getRankStr(card.rank);
        const s = SUIT_SYMBOLS[card.suit];
        wrap.innerHTML = `
          ${isSel ? `<div class="selection-order-badge">#${selIdx + 1}</div>` : ''}
          <div class="table-card ${isRed ? 'red' : 'black'}">
            <div class="card-corner top"><span>${r}</span><span>${s}</span></div>
            <div class="card-center-pip">${s}</div>
            <div class="card-corner bottom"><span>${r}</span><span>${s}</span></div>
          </div>
        `;

        // Click to toggle selection
        wrap.addEventListener('click', (e) => {
          if (wrap.dataset.wasDragged === 'true') {
            wrap.dataset.wasDragged = 'false';
            return;
          }
          audio.play('card_slide');
          onSelectCard(card);
        });

        // Pointer Drag-and-Drop
        this._bindCardDrag(wrap, card, selectedCards, onPlaySelected);
        track.appendChild(wrap);
      });

      // Bind Draw-to-Drag on Draw Pile
      this._bindDrawPileDrag(onDrawOne);
    }

    _bindCardDrag(cardEl, card, selectedCards, onPlaySelected) {
      let startX = 0;
      let startY = 0;
      let currentX = 0;
      let currentY = 0;
      let isDragging = false;
      let lastTime = 0;
      let velX = 0;
      let velY = 0;

      const dropZone = document.getElementById('discard-drop-zone');
      const reticle = document.getElementById('drop-target-reticle');
      const centerFelt = document.getElementById('center-felt');

      const onPointerDown = (e) => {
        startX = e.clientX;
        startY = e.clientY;
        lastTime = performance.now();
        velX = 0;
        velY = 0;
        cardEl.dataset.wasDragged = 'false';

        cardEl.setPointerCapture(e.pointerId);
        cardEl.addEventListener('pointermove', onPointerMove);
        cardEl.addEventListener('pointerup', onPointerUp);
        cardEl.addEventListener('pointercancel', onPointerUp);
      };

      const onPointerMove = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!isDragging && Math.hypot(dx, dy) > 8) {
          isDragging = true;
          cardEl.dataset.wasDragged = 'true';
          cardEl.classList.add('dragging');
          audio.play('card_slide');
        }

        if (isDragging) {
          const now = performance.now();
          const dt = Math.max(1, now - lastTime);
          velX = (e.clientX - currentX) / dt;
          velY = (e.clientY - currentY) / dt;
          lastTime = now;
          currentX = e.clientX;
          currentY = e.clientY;

          // 3D perspective velocity tilt
          const tiltX = Math.max(-25, Math.min(25, -velY * 18));
          const tiltY = Math.max(-25, Math.min(25, velX * 18));

          cardEl.style.transform = `translate(${dx}px, ${dy}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(1.12)`;

          // Check if hovering over Discard Pile drop zone
          if (dropZone && reticle) {
            const rect = dropZone.getBoundingClientRect();
            const inZone =
              e.clientX >= rect.left - 20 &&
              e.clientX <= rect.right + 20 &&
              e.clientY >= rect.top - 20 &&
              e.clientY <= rect.bottom + 20;

            if (inZone) {
              reticle.classList.add('active');
            } else {
              reticle.classList.remove('active');
            }
          }

          // Throttle broadcast normalized telemetry to peers (~30fps)
          if (centerFelt && window.Crazy8Network && !this.throttleTimer) {
            this.throttleTimer = setTimeout(() => {
              this.throttleTimer = null;
              const fRect = centerFelt.getBoundingClientRect();
              const nx = (e.clientX - fRect.left) / fRect.width;
              const ny = (e.clientY - fRect.top) / fRect.height;
              window.Crazy8Network.sendTelemetry({
                type: 'DRAG_MOVE',
                cardId: card.id,
                nx: nx,
                ny: ny,
                tiltX: tiltX,
                tiltY: tiltY,
              });
            }, 33);
          }
        }
      };

      const onPointerUp = (e) => {
        cardEl.removeEventListener('pointermove', onPointerMove);
        cardEl.removeEventListener('pointerup', onPointerUp);
        cardEl.removeEventListener('pointercancel', onPointerUp);

        if (reticle) reticle.classList.remove('active');

        if (isDragging) {
          isDragging = false;
          cardEl.classList.remove('dragging');

          // Send drag end telemetry
          if (window.Crazy8Network) {
            window.Crazy8Network.sendTelemetry({ type: 'DRAG_END', cardId: card.id });
          }

          // Check drop zone collision
          if (dropZone) {
            const rect = dropZone.getBoundingClientRect();
            const droppedInZone =
              e.clientX >= rect.left - 30 &&
              e.clientX <= rect.right + 30 &&
              e.clientY >= rect.top - 30 &&
              e.clientY <= rect.bottom + 30;

            if (droppedInZone) {
              audio.play('card_snap');
              // Play combo if this card was part of selectedCards, else play this single card
              const toPlay = selectedCards.includes(card.id) ? selectedCards : [card.id];
              onPlaySelected(toPlay, null);
              return;
            }
          }

          // Reset position if dropped outside
          cardEl.style.transform = '';
        }
      };

      cardEl.addEventListener('pointerdown', onPointerDown);
    }

    _bindDrawPileDrag(onDrawOne) {
      const drawCard = document.getElementById('draw-pile-card');
      if (!drawCard || drawCard.dataset.dragBound === 'true') return;
      drawCard.dataset.dragBound = 'true';

      let startY = 0;
      let isDragging = false;

      drawCard.addEventListener('pointerdown', (e) => {
        startY = e.clientY;
        isDragging = false;

        const onMove = (ev) => {
          const dy = ev.clientY - startY;
          if (dy > 30 && !isDragging) {
            isDragging = true;
            audio.play('draw');
          }
        };

        const onUp = (ev) => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (isDragging) {
            onDrawOne();
          }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    }

    // -------------------------------------------------------------
    // MESSY PHYSICAL DISCARD STACK
    // -------------------------------------------------------------

    renderDiscardStack(discardPile) {
      const container = document.getElementById('discard-stack');
      if (!container || !discardPile || discardPile.length === 0) return;
      container.innerHTML = '';

      // Render top 4 cards with organic scatter
      const slice = discardPile.slice(-4);
      slice.forEach((c, idx) => {
        const scatter = getCardScatter(c.id);
        const isRed = c.suit === 'H' || c.suit === 'D';
        const isTop = idx === slice.length - 1;

        const el = document.createElement('div');
        el.className = `table-card ${isRed ? 'red' : 'black'}`;
        el.style.transform = `translate(${scatter.ox}px, ${scatter.oy}px) rotate(${scatter.rot}deg)`;
        el.style.zIndex = 5 + idx;

        const r = getRankStr(c.rank);
        const s = SUIT_SYMBOLS[c.suit];
        el.innerHTML = `
          <div class="card-corner top"><span>${r}</span><span>${s}</span></div>
          <div class="card-center-pip">${s}</div>
          <div class="card-corner bottom"><span>${r}</span><span>${s}</span></div>
        `;
        container.appendChild(el);
      });
    }

    // -------------------------------------------------------------
    // WATCH OTHER PLAYERS DRAG CARDS (Remote Ghost Cards)
    // -------------------------------------------------------------

    renderRemoteTelemetry(telemetry, room) {
      const centerFelt = document.getElementById('center-felt');
      if (!centerFelt || !telemetry) return;

      const senderId = telemetry.senderId;
      const data = telemetry.data || {};

      if (data.type === 'EMOTE') {
        this.showSeatEmote(data.playerId, data.emoji, room);
        return;
      }

      if (data.type === 'DRAG_END') {
        if (remoteGhosts.has(senderId)) {
          const el = remoteGhosts.get(senderId);
          el.remove();
          remoteGhosts.delete(senderId);
        }
        return;
      }

      if (data.type === 'DRAG_MOVE' || data.type === 'BOT_DRAG') {
        let ghost = remoteGhosts.get(senderId || data.botId);
        if (!ghost) {
          ghost = document.createElement('div');
          ghost.className = 'table-card card-back remote-ghost-card';
          const name = telemetry.senderName || data.botName || 'Opponent';
          ghost.innerHTML = `
            <div class="remote-ghost-badge">${name} dragging...</div>
            <span class="draw-pile-text">🂠</span>
          `;
          centerFelt.appendChild(ghost);
          remoteGhosts.set(senderId || data.botId, ghost);
        }

        const fRect = centerFelt.getBoundingClientRect();
        const px = data.nx * fRect.width;
        const py = data.ny * fRect.height;
        const tiltX = data.tiltX || 0;
        const tiltY = data.tiltY || 0;

        ghost.style.left = `${px - 38}px`;
        ghost.style.top = `${py - 55}px`;
        ghost.style.transform = `rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(1.08)`;
      }
    }

    showSeatEmote(playerId, emoji, room) {
      const bubble = document.getElementById(`emote-seat-${playerId}`);
      if (bubble) {
        bubble.innerText = emoji;
        bubble.style.display = 'flex';
        audio.play('emote');
        setTimeout(() => {
          bubble.style.display = 'none';
        }, 1600);
      }
    }

    // -------------------------------------------------------------
    // FLYING CARD & SPECIAL RULE VISUAL EFFECTS
    // -------------------------------------------------------------

    playActionEffects(lastAction, prevRoom, newRoom) {
      if (!lastAction) return;

      switch (lastAction.type) {
        case 'DEAL':
          audio.play('card_slide');
          this._animateDeal(newRoom);
          break;
        case 'DRAW':
        case 'DRAW_UNTIL':
          audio.play('draw');
          break;
        case 'PLAY':
          audio.play('card_snap');
          break;
        case 'REVERSE':
          audio.play('reverse');
          this._animateReverse();
          break;
        case 'STACK_TWO':
          audio.play('penalty_impact');
          this._screenShake();
          break;
        case 'INTERCEPT_TWO':
          audio.play('intercept');
          this._screenShake();
          break;
        case 'WILD':
          audio.play('card_snap');
          this._animateWildPrism(lastAction.chosen_suit);
          break;
        case 'WIN':
          audio.play('win');
          this._triggerConfetti();
          break;
      }

      if (lastAction.splash_target_ids && lastAction.splash_target_ids.length > 0) {
        this._animateSplashDamage(lastAction.splash_target_ids);
      }
    }

    _animateDeal(room) {
      const vfx = document.getElementById('vfx-layer');
      if (!vfx) return;

      const dealerSeat = document.querySelector('.opponent-seat.active-turn') || vfx;
      const dRect = dealerSeat.getBoundingClientRect();

      for (let i = 0; i < 6; i++) {
        setTimeout(() => {
          const card = document.createElement('div');
          card.className = 'table-card card-back flying-card';
          card.style.left = `${dRect.left + 20}px`;
          card.style.top = `${dRect.top + 20}px`;
          vfx.appendChild(card);

          setTimeout(() => {
            card.style.left = '50%';
            card.style.top = '75%';
            card.style.opacity = '0';
          }, 30);

          setTimeout(() => card.remove(), 600);
        }, i * 70);
      }
    }

    _animateReverse() {
      const felt = document.getElementById('center-felt');
      if (!felt) return;
      const ring = document.createElement('div');
      ring.className = 'reverse-ring-vfx';
      felt.appendChild(ring);
      setTimeout(() => ring.remove(), 1100);
    }

    _screenShake() {
      const table = document.getElementById('game-table');
      if (!table) return;
      table.style.animation = 'none';
      table.offsetHeight; // reflow
      table.style.animation = 'shake-table 0.4s ease-in-out';
      setTimeout(() => (table.style.animation = ''), 400);
    }

    _animateWildPrism(suit) {
      const felt = document.getElementById('center-felt');
      if (!felt) return;
      const glow = document.getElementById('active-suit-box');
      if (glow) {
        glow.style.transform = 'scale(1.25)';
        setTimeout(() => (glow.style.transform = 'scale(1)'), 400);
      }
    }

    _animateSplashDamage(targetIds) {
      targetIds.forEach((id) => {
        const seat = document.getElementById(`seat-${id}`);
        if (!seat) return;
        const rect = seat.getBoundingClientRect();
        const popup = document.createElement('div');
        popup.className = 'splash-damage-popup';
        popup.innerText = '+1 SPLASH!';
        popup.style.left = `${rect.left + 20}px`;
        popup.style.top = `${rect.top - 10}px`;
        document.body.appendChild(popup);
        setTimeout(() => popup.remove(), 1200);
      });
    }

    _triggerConfetti() {
      const vfx = document.getElementById('vfx-layer');
      if (!vfx) return;
      for (let i = 0; i < 40; i++) {
        const conf = document.createElement('div');
        conf.style.position = 'absolute';
        conf.style.left = `${Math.random() * 100}%`;
        conf.style.top = '-20px';
        conf.style.width = '10px';
        conf.style.height = '14px';
        conf.style.background = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6'][Math.floor(Math.random() * 4)];
        conf.style.transform = `rotate(${Math.random() * 360}deg)`;
        conf.style.transition = `all ${1.5 + Math.random()}s ease-out`;
        conf.style.zIndex = '2500';
        vfx.appendChild(conf);

        setTimeout(() => {
          conf.style.top = '105%';
          conf.style.transform = `rotate(${Math.random() * 720}deg) scale(0.6)`;
        }, 30);
        setTimeout(() => conf.remove(), 2500);
      }
    }
  }

  const ux = new TabletopUX();

  return {
    Audio: audio,
    UX: ux,
  };
});
