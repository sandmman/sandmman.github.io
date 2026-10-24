/**
 * Extra Crazy 8s Tabletop UX & Interactive Card Physics Engine
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
          case 'skip':
            this._chordSweep(now, [523.25, 783.99], 0.18);
            break;
          case 'penalty_impact':
            this._bassDrop(now);
            break;
          case 'intercept':
            this._electricArp(now);
            break;
          case 'turn_chime':
            this._toneBell(now, 587.33);
            break;
          case 'win':
            this._fanfare(now);
            break;
          case 'emote':
            this._toneSweep(now, 400, 750, 0.08, 'triangle', 0.15);
            break;
          case 'callout':
            this._chordSweep(now, [523.25, 659.25], 0.14);
            break;
          case 'table_knock':
            this._woodKnock(now);
            break;
          case 'whistle':
          case 'referee_whistle':
            this._refereeWhistle(now);
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
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, idx) => {
        const noteT = t + idx * 0.12;
        this._toneBell(noteT, f);
      });
    }

    _woodKnock(t) {
      // Double-tap warm wooden table thud (2 knocks 90ms apart)
      [0, 0.09].forEach((offset) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(115, t + offset);
        osc.frequency.exponentialRampToValueAtTime(42, t + offset + 0.075);
        gain.gain.setValueAtTime(0.45, t + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.08);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t + offset);
        osc.stop(t + offset + 0.08);
      });
    }

    _refereeWhistle(t) {
      // Authentic dual-oscillator pea-whistle FM trill (~2840Hz + ~2980Hz modulated by 32Hz LFO)
      const dur = 0.42;
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      const mainGain = this.ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';
      osc1.frequency.setValueAtTime(2820, t);
      osc2.frequency.setValueAtTime(2990, t);

      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(32, t);
      lfoGain.gain.setValueAtTime(140, t);

      lfo.connect(lfoGain);
      lfoGain.connect(osc1.frequency);
      lfoGain.connect(osc2.frequency);

      mainGain.gain.setValueAtTime(0.001, t);
      mainGain.gain.linearRampToValueAtTime(0.32, t + 0.025);
      mainGain.gain.setValueAtTime(0.32, t + dur - 0.06);
      mainGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc1.connect(mainGain);
      osc2.connect(mainGain);
      mainGain.connect(this.ctx.destination);

      osc1.start(t);
      osc2.start(t);
      lfo.start(t);
      osc1.stop(t + dur);
      osc2.stop(t + dur);
      lfo.stop(t + dur);
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

  // Persistent pseudo-random scatter angles for buried discard pile cards
  const discardAngleCache = new Map();

  function getCardScatter(cardId) {
    if (!discardAngleCache.has(cardId)) {
      const rot = (Math.random() * 22 - 11).toFixed(1);
      const ox = (Math.random() * 10 - 5).toFixed(1);
      const oy = (Math.random() * 10 - 5).toFixed(1);
      discardAngleCache.set(cardId, { rot, ox, oy });
    }
    return discardAngleCache.get(cardId);
  }

  // Active remote drag ghosts & sequence/watchdog tracking
  const remoteGhosts = new Map(); // senderId -> { el, watchdogTimer }
  const remoteTelemetrySeq = new Map(); // senderId -> highest seq processed

  class TabletopUX {
    constructor() {
      this.dragState = null;
      this.throttleTimer = null;
      this.hoverThrottleTimer = null;
      this.localTelemetrySeq = 0;
    }

    clearRemoteGhost(ghostId) {
      if (!ghostId) return;
      if (remoteGhosts.has(ghostId)) {
        const entry = remoteGhosts.get(ghostId);
        if (entry.watchdogTimer) clearTimeout(entry.watchdogTimer);
        if (entry.el && entry.el.parentNode) entry.el.remove();
        remoteGhosts.delete(ghostId);
      }
      const seat = document.getElementById(`seat-${ghostId}`);
      if (seat) {
        const lifted = seat.querySelectorAll('.mini-card-back.ghost-lifted');
        lifted.forEach((c) => c.classList.remove('ghost-lifted'));
      }
    }

    clearAllRemoteGhosts() {
      for (const ghostId of Array.from(remoteGhosts.keys())) {
        this.clearRemoteGhost(ghostId);
      }
      const centerFelt = document.getElementById('center-felt');
      if (centerFelt) {
        centerFelt
          .querySelectorAll('.remote-ghost-card')
          .forEach((el) => el.remove());
      }
    }

    _sendHoverTelemetry(hoverIndex, handCount) {
      if (!window.Crazy8Network || this.hoverThrottleTimer) return;
      this.hoverThrottleTimer = setTimeout(() => {
        this.hoverThrottleTimer = null;
        window.Crazy8Network.sendTelemetry({
          type: 'HAND_HOVER',
          hoverIndex: hoverIndex,
          handCount: handCount,
        });
      }, 60);
    }

    // -------------------------------------------------------------
    // INTERACTIVE PLAYER HAND (Curved Fan & Drag-and-Drop)
    // -------------------------------------------------------------

    renderInteractiveHand(
      hand,
      selectedCards,
      room,
      isMyTurn,
      onSelectCard,
      onPlaySelected,
      onDrawOne
    ) {
      this.onDrawOneCallback = onDrawOne;
      const track = document.getElementById('hand-fan-track');
      if (!track) return;
      track.innerHTML = '';

      if (window.Crazy8Engine && window.Crazy8Engine.sortHand) {
        window.Crazy8Engine.sortHand(hand);
      }

      const N = hand.length;
      const viewportEl = track.parentElement || document.body;
      const availWidth = Math.min(
        860,
        Math.max(280, (viewportEl.clientWidth || window.innerWidth) - 130)
      );
      const maxArcSpread = Math.min(26, N * 2.2);
      const angleStep = N > 1 ? Math.min(4.2, maxArcSpread / (N - 1)) : 0;
      const xSpacing = N > 1 ? Math.min(54, availWidth / (N - 1)) : 0;
      const maxArchLift = Math.min(16, N * 1.4);

      const mePlayer =
        room && room.players
          ? room.players.find((p) => Array.isArray(p.hand) && p.hand.length > 0) ||
            { hand: hand }
          : { hand: hand };

      hand.forEach((card, idx) => {
        const isPlayable =
          isMyTurn &&
          (window.Crazy8Engine && window.Crazy8Engine.isCardPlayableInTurn
            ? window.Crazy8Engine.isCardPlayableInTurn(room, mePlayer, card)
            : true);

        const selIdx = selectedCards.indexOf(card.id);
        const isSel = selIdx !== -1;
        const isRed = card.suit === 'H' || card.suit === 'D';

        const mid = (N - 1) / 2;
        const norm = N > 1 ? (idx - mid) / Math.max(1, mid) : 0; // -1 at left edge, 0 at center, +1 at right edge
        const rot = (idx - mid) * angleStep;
        const xOffset = (idx - mid) * xSpacing;
        // Center cards arch UPWARD (negative yOffset <= 0); outer cards sit at 0px so they NEVER drop over the action buttons!
        const yOffset = (Math.pow(norm, 2) - 1) * maxArchLift;

        const wrap = document.createElement('div');
        wrap.className = `hand-card-wrapper ${isPlayable ? 'playable' : ''} ${
          isSel ? 'selected' : ''
        }`;
        wrap.dataset.cardId = card.id;
        wrap.style.setProperty('--base-x', `${xOffset}px`);
        wrap.style.setProperty('--base-y', `${yOffset}px`);
        wrap.style.setProperty('--base-rot', `${rot}deg`);
        wrap.style.setProperty('--base-z', `${10 + idx}`);

        const r = getRankStr(card.rank);
        const s = SUIT_SYMBOLS[card.suit];
        const specialTag =
          card.rank === 8
            ? 'WILD'
            : card.rank === 2
            ? '+2'
            : card.rank === 7
            ? 'REV'
            : card.rank === 12
            ? 'SKIP'
            : '';

        wrap.innerHTML = `
          ${isSel ? `<div class="selection-order-badge">#${selIdx + 1}</div>` : ''}
          <div class="table-card ${isRed ? 'red' : 'black'}">
            <div class="card-corner top"><span>${r}</span><span>${s}</span></div>
            <div class="card-center-pip">${s}</div>
            ${specialTag ? `<div class="card-special-ribbon">${specialTag}</div>` : ''}
            <div class="card-corner bottom"><span>${r}</span><span>${s}</span></div>
          </div>
        `;

        // Hover telemetry ("card fingering") so opponents see which card in your fan you're hovering
        wrap.addEventListener('pointerenter', () => {
          this._sendHoverTelemetry(idx, N);
        });
        wrap.addEventListener('pointerleave', () => {
          this._sendHoverTelemetry(-1, N);
        });

        // Click to toggle selection
        wrap.addEventListener('click', () => {
          if (wrap.dataset.wasDragged === 'true') {
            wrap.dataset.wasDragged = 'false';
            return;
          }
          audio.play('card_slide');
          onSelectCard(card);
        });

        // Pointer Drag-and-Drop
        this._bindCardDrag(wrap, card, isPlayable, selectedCards, onPlaySelected);
        track.appendChild(wrap);
      });

      this._bindDrawPileDrag(onDrawOne);
    }

    _bindCardDrag(cardEl, card, isPlayable, selectedCards, onPlaySelected) {
      let startX = 0;
      let startY = 0;
      let currentX = 0;
      let currentY = 0;
      let isDragging = false;
      let lastTime = 0;
      let smoothTiltX = 0;
      let smoothTiltY = 0;
      let rafId = null;

      const dropZone = document.getElementById('discard-drop-zone');
      const reticle = document.getElementById('drop-target-reticle');

      const cleanupListeners = () => {
        cardEl.removeEventListener('pointermove', onPointerMove);
        cardEl.removeEventListener('pointerup', onPointerUp);
        cardEl.removeEventListener('pointercancel', onPointerUp);
        cardEl.removeEventListener('lostpointercapture', onPointerUp);
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (this.throttleTimer) {
          clearTimeout(this.throttleTimer);
          this.throttleTimer = null;
        }
      };

      const onPointerDown = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        startX = e.clientX;
        startY = e.clientY;
        currentX = e.clientX;
        currentY = e.clientY;
        lastTime = performance.now();
        smoothTiltX = 0;
        smoothTiltY = 0;
        cardEl.dataset.wasDragged = 'false';

        try {
          cardEl.setPointerCapture(e.pointerId);
        } catch (err) {}
        cardEl.addEventListener('pointermove', onPointerMove);
        cardEl.addEventListener('pointerup', onPointerUp);
        cardEl.addEventListener('pointercancel', onPointerUp);
        cardEl.addEventListener('lostpointercapture', onPointerUp);
      };

      const onPointerMove = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!isDragging && Math.hypot(dx, dy) > 8) {
          isDragging = true;
          cardEl.dataset.wasDragged = 'true';
          cardEl.classList.add('dragging');
          const trackEl = document.getElementById('hand-fan-track');
          if (trackEl) trackEl.classList.add('dragging-active');
          audio.play('card_slide');
        }

        if (isDragging) {
          const now = performance.now();
          const dt = Math.max(8, now - lastTime);
          const velX = (e.clientX - currentX) / dt;
          const velY = (e.clientY - currentY) / dt;
          lastTime = now;
          currentX = e.clientX;
          currentY = e.clientY;

          const targetTiltX = Math.max(-14, Math.min(14, -velY * 10));
          const targetTiltY = Math.max(-14, Math.min(14, velX * 10));
          smoothTiltX = smoothTiltX * 0.78 + targetTiltX * 0.22;
          smoothTiltY = smoothTiltY * 0.78 + targetTiltY * 0.22;

          if (!rafId) {
            rafId = requestAnimationFrame(() => {
              rafId = null;
              if (!isDragging) return;
              const curDx = currentX - startX;
              const curDy = currentY - startY;
              cardEl.style.transform = `translate3d(calc(var(--base-x, 0px) + ${curDx}px), calc(var(--base-y, 0px) + ${curDy}px), 0) rotateX(${smoothTiltX.toFixed(
                1
              )}deg) rotateY(${smoothTiltY.toFixed(1)}deg) scale(1.08)`;
            });
          }

          if (dropZone && reticle) {
            const rect = dropZone.getBoundingClientRect();
            const inZone =
              e.clientX >= rect.left - 35 &&
              e.clientX <= rect.right + 35 &&
              e.clientY >= rect.top - 35 &&
              e.clientY <= rect.bottom + 35;

            if (inZone && isPlayable) {
              reticle.classList.add('active');
            } else {
              reticle.classList.remove('active');
            }
          }

          if (dropZone && window.Crazy8Network && !this.throttleTimer) {
            this.throttleTimer = setTimeout(() => {
              this.throttleTimer = null;
              if (!isDragging) return;
              const dRect = dropZone.getBoundingClientRect();
              const dropCenterY = dRect.top + dRect.height / 2;
              const distY = Math.max(100, startY - dropCenterY);
              const v = Math.max(
                -0.15,
                Math.min(1.15, (startY - currentY) / distY)
              );
              const u = Math.max(
                -1.2,
                Math.min(1.2, (currentX - startX) / distY)
              );

              this.localTelemetrySeq += 1;
              window.Crazy8Network.sendTelemetry({
                type: 'DRAG_MOVE',
                seq: this.localTelemetrySeq,
                cardId: card.id,
                v: v,
                u: u,
                tiltX: smoothTiltX,
                tiltY: smoothTiltY,
              });
            }, 33);
          }
        }
      };

      const onPointerUp = (e) => {
        const wasDragging = isDragging;
        isDragging = false;
        cleanupListeners();

        const trackEl = document.getElementById('hand-fan-track');
        if (trackEl) trackEl.classList.remove('dragging-active');
        if (reticle) reticle.classList.remove('active');

        if (wasDragging) {
          cardEl.classList.remove('dragging');

          if (window.Crazy8Network) {
            this.localTelemetrySeq += 1;
            window.Crazy8Network.sendTelemetry({
              type: 'DRAG_END',
              seq: this.localTelemetrySeq,
              cardId: card.id,
            });
          }

          if (dropZone) {
            const rect = dropZone.getBoundingClientRect();
            const endX = e.clientX !== undefined ? e.clientX : currentX;
            const endY = e.clientY !== undefined ? e.clientY : currentY;
            const droppedInZone =
              endX >= rect.left - 45 &&
              endX <= rect.right + 45 &&
              endY >= rect.top - 45 &&
              endY <= rect.bottom + 45;

            if (droppedInZone && isPlayable) {
              audio.play('card_snap');
              const toPlay = selectedCards.includes(card.id)
                ? selectedCards
                : [card.id];
              cardEl.style.transform = '';
              onPlaySelected(toPlay, null);
              return;
            }
          }

          cardEl.style.transform = '';
        }
      };

      cardEl.addEventListener('pointerdown', onPointerDown);
    }

    _bindDrawPileDrag(onDrawOne) {
      if (onDrawOne) this.onDrawOneCallback = onDrawOne;
      const drawCard = document.getElementById('draw-pile-card');
      if (!drawCard || drawCard.dataset.dragBound === 'true') return;
      drawCard.dataset.dragBound = 'true';

      let startX = 0;
      let startY = 0;
      let isDragging = false;

      drawCard.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        startX = e.clientX;
        startY = e.clientY;
        isDragging = false;

        const onMove = (ev) => {
          const dy = ev.clientY - startY;
          if (dy > 24 && !isDragging) {
            isDragging = true;
          }
        };

        const onUp = (ev) => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          const dx = (ev.clientX || startX) - startX;
          const dy = (ev.clientY || startY) - startY;
          const isClick = !isDragging && Math.hypot(dx, dy) <= 16;
          if ((isDragging || isClick) && typeof this.onDrawOneCallback === 'function') {
            this.onDrawOneCallback();
          }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    }

    // -------------------------------------------------------------
    // 3D DRAW PILE DEPTH & MULTI-CARD COMBO FAN ON DISCARD PILE
    // -------------------------------------------------------------

    renderDrawPileDepth(count) {
      const drawCard = document.getElementById('draw-pile-card');
      if (!drawCard) return;
      const layers = Math.min(6, Math.max(1, Math.ceil((count || 0) / 8)));
      const shadows = [];
      for (let i = 1; i <= layers; i++) {
        shadows.push(
          `${i * 1.5}px ${i * 1.8}px 0px ${i % 2 === 0 ? '#1e3a8a' : '#93c5fd'}`
        );
      }
      shadows.push(`0 ${4 + layers * 2}px ${12 + layers * 2}px rgba(0,0,0,0.55)`);
      drawCard.style.boxShadow = shadows.join(', ');
    }

    renderDiscardStack(discardPile, lastAction = null, rankStreak = null) {
      const container = document.getElementById('discard-stack');
      if (!container || !discardPile || discardPile.length === 0) return;
      container.innerHTML = '';

      const topCard = discardPile[discardPile.length - 1];
      let trailingSameRank = 1;
      for (let i = discardPile.length - 2; i >= 0; i--) {
        if (discardPile[i].rank === topCard.rank) {
          trailingSameRank += 1;
        } else {
          break;
        }
      }

      const streakLen =
        Array.isArray(rankStreak) && rankStreak.length > 0
          ? rankStreak.length
          : trailingSameRank;
      const activeStackCount = Math.min(
        discardPile.length,
        Math.max(1, streakLen)
      );

      const badge = document.getElementById('combo-fan-badge');
      if (badge) {
        const topRankStr = getRankStr(topCard.rank);
        const stackSuits = discardPile
          .slice(-activeStackCount)
          .map((c) => `${getRankStr(c.rank)}${SUIT_SYMBOLS[c.suit]}`)
          .join(' • ');
        if (activeStackCount >= 2) {
          badge.innerText = `⚡ Active ${topRankStr} Stack (${activeStackCount}/4): ${stackSuits}`;
          badge.style.display = 'block';
        } else {
          badge.style.display = 'none';
        }
      }

      // Render up to 3 buried history cards underneath the active rank stack
      const historyEnd = Math.max(0, discardPile.length - activeStackCount);
      const historySlice = discardPile.slice(
        Math.max(0, historyEnd - 3),
        historyEnd
      );
      historySlice.forEach((c, idx) => {
        const scatter = getCardScatter(c.id);
        const isRed = c.suit === 'H' || c.suit === 'D';
        const el = document.createElement('div');
        el.className = `table-card ${isRed ? 'red' : 'black'}`;
        el.style.transform = `translate(${scatter.ox}px, ${scatter.oy}px) rotate(${scatter.rot}deg)`;
        el.style.filter = 'brightness(0.76)';
        el.style.zIndex = 2 + idx;

        const r = getRankStr(c.rank);
        const s = SUIT_SYMBOLS[c.suit];
        el.innerHTML = `
          <div class="card-corner top"><span>${r}</span><span>${s}</span></div>
          <div class="card-center-pip">${s}</div>
          <div class="card-corner bottom"><span>${r}</span><span>${s}</span></div>
        `;
        container.appendChild(el);
      });

      // Render all cards in the currently active rank stack fanned out left-to-right
      const activeStackSlice = discardPile.slice(-activeStackCount);
      const mid = (activeStackSlice.length - 1) / 2;
      activeStackSlice.forEach((c, j) => {
        const isRed = c.suit === 'H' || c.suit === 'D';
        const el = document.createElement('div');
        el.className = `table-card ${isRed ? 'red' : 'black'} active-stack-card`;

        if (activeStackCount > 1) {
          const ox = (j - mid) * 24;
          const oy = Math.abs(j - mid) * 3 - 2;
          const rot = (j - mid) * 8;
          el.style.transform = `translate(${ox}px, ${oy}px) rotate(${rot}deg)`;
        } else {
          const scatter = getCardScatter(c.id);
          el.style.transform = `translate(${scatter.ox}px, ${scatter.oy}px) rotate(${scatter.rot}deg)`;
        }
        el.style.zIndex = 10 + j;

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
    // WATCH OTHER PLAYERS DRAG & HOVER CARDS (Remote Telemetry)
    // -------------------------------------------------------------

    renderRemoteTelemetry(telemetry, room) {
      const centerFelt = document.getElementById('center-felt');
      if (!centerFelt || !telemetry) return;

      const senderId = telemetry.senderId;
      const data = telemetry.data || {};
      const ghostId = data.botId || senderId;

      if (data.type === 'EMOTE') {
        this.showSeatEmote(data.playerId || senderId, data.emoji, room);
        return;
      }

      if (data.type === 'CALLOUT') {
        this.showSeatCallout(
          data.playerId || senderId,
          data.text,
          data.style,
          room
        );
        return;
      }

      if (data.type === 'TABLE_TAP') {
        this.playTableTap(data.playerId || senderId, data.nx, data.ny, room);
        return;
      }

      if (data.type === 'REFEREE_WHISTLE') {
        this.playRefereeWhistleEffect(data);
        return;
      }

      if (data.type === 'HAND_HOVER') {
        const seat = document.getElementById(`seat-${senderId}`);
        if (seat) {
          const minis = seat.querySelectorAll('.mini-card-back');
          minis.forEach((m) => m.classList.remove('hovered-by-owner'));
          if (data.hoverIndex >= 0 && minis.length > 0) {
            const mapped = Math.min(
              minis.length - 1,
              Math.floor(
                (data.hoverIndex / Math.max(1, data.handCount)) * minis.length
              )
            );
            if (minis[mapped]) minis[mapped].classList.add('hovered-by-owner');
          }
        }
        return;
      }

      // Enforce monotonic sequence ordering per sender so delayed multi-transport
      // DRAG_MOVE packets can never resurrect a ghost card after DRAG_END
      if (typeof data.seq === 'number' && ghostId) {
        const lastSeq = remoteTelemetrySeq.get(ghostId) || 0;
        if (data.seq < lastSeq && lastSeq - data.seq < 5000) {
          return;
        }
        remoteTelemetrySeq.set(ghostId, data.seq);
      }

      if (data.type === 'DRAG_END') {
        this.clearRemoteGhost(ghostId);
        return;
      }

      if (data.type === 'DRAG_MOVE' || data.type === 'BOT_DRAG') {
        let entry = remoteGhosts.get(ghostId);

        const seatEl = document.getElementById(`seat-${ghostId}`);
        const miniFan = seatEl ? seatEl.querySelector('.mini-card-fan') : null;

        if (miniFan) {
          const cards = miniFan.querySelectorAll('.mini-card-back');
          if (cards.length > 0 && !miniFan.querySelector('.ghost-lifted')) {
            cards[cards.length - 1].classList.add('ghost-lifted');
          }
        }

        const fRect = centerFelt.getBoundingClientRect();
        const dropZone = document.getElementById('discard-drop-zone');
        const dRect = dropZone ? dropZone.getBoundingClientRect() : fRect;

        const targetX = dRect.left + dRect.width / 2 - fRect.left;
        const targetY = dRect.top + dRect.height / 2 - fRect.top;

        let seatX = fRect.width * 0.5;
        let seatY = -20;
        if (miniFan) {
          const sRect = miniFan.getBoundingClientRect();
          seatX = sRect.left + sRect.width / 2 - fRect.left;
          seatY = sRect.top + sRect.height / 2 - fRect.top;
        } else if (seatEl) {
          const sRect = seatEl.getBoundingClientRect();
          seatX = sRect.left + sRect.width / 2 - fRect.left;
          seatY = sRect.top + sRect.height / 2 - fRect.top;
        }

        if (!entry || !entry.el || !entry.el.parentNode) {
          const ghostEl = document.createElement('div');
          ghostEl.className = 'table-card card-back remote-ghost-card';
          const name = data.botName || telemetry.senderName || 'Opponent';
          ghostEl.innerHTML = `
            <div class="remote-ghost-badge">${name}</div>
            <span class="draw-pile-text">🂠</span>
          `;
          ghostEl.style.transform = `translate3d(${seatX - 38}px, ${
            seatY - 55
          }px, 0) scale(0.85)`;
          centerFelt.appendChild(ghostEl);
          entry = { el: ghostEl, watchdogTimer: null };
          remoteGhosts.set(ghostId, entry);
        }

        if (entry.watchdogTimer) clearTimeout(entry.watchdogTimer);
        entry.watchdogTimer = setTimeout(() => {
          this.clearRemoteGhost(ghostId);
        }, 900);

        const v =
          typeof data.v === 'number'
            ? data.v
            : typeof data.progress === 'number'
            ? data.progress
            : 0.5;
        const u = typeof data.u === 'number' ? data.u : 0;

        const px = seatX + (targetX - seatX) * v - u * 120;
        const py = seatY + (targetY - seatY) * v;
        const tiltX = data.tiltX || 0;
        const tiltY = data.tiltY || 0;
        const scale = 0.88 + Math.min(1, Math.max(0, v)) * 0.16;

        entry.el.style.transform = `translate3d(${px - 38}px, ${
          py - 55
        }px, 0) rotateX(${tiltX.toFixed(1)}deg) rotateY(${tiltY.toFixed(
          1
        )}deg) rotateZ(${((1 - v) * 8).toFixed(1)}deg) scale(${scale.toFixed(
          2
        )})`;
      }
    }

    showSeatEmote(playerId, emoji) {
      const bubble =
        document.getElementById(`emote-seat-${playerId}`) ||
        document.getElementById('emote-seat-local');
      if (bubble) {
        bubble.innerText = emoji;
        bubble.style.display = 'flex';
        audio.play('emote');
        setTimeout(() => {
          bubble.style.display = 'none';
        }, 1600);
      }
    }

    showSeatCallout(playerId, text) {
      const bubble =
        document.getElementById(`callout-seat-${playerId}`) ||
        document.getElementById('callout-seat-local');
      if (bubble) {
        bubble.innerText = text;
        bubble.style.display = 'block';
        audio.play('callout');
        setTimeout(() => {
          bubble.style.display = 'none';
        }, 2200);
      }
    }

    playTableTap(playerId, nx = 0.5, ny = 0.5) {
      audio.play('table_knock');
      const felt = document.getElementById('center-felt');
      if (!felt) return;
      const ripple = document.createElement('div');
      ripple.className = 'table-tap-ripple';
      ripple.style.left = `${(nx * 100).toFixed(1)}%`;
      ripple.style.top = `${(ny * 100).toFixed(1)}%`;
      felt.appendChild(ripple);
      setTimeout(() => ripple.remove(), 800);
    }

    playRefereeWhistleEffect(data) {
      audio.play('whistle');
      setTimeout(() => audio.play('penalty_impact'), 160);
      this._screenShake();
      const targetId = data.target_id || data.targetId;
      const count = data.count || 1;
      const reasonLabel = data.reason_label || data.reason || 'Verbal Rule Penalty';
      const drawnCards = data.drawn_cards || (data.card ? [data.card] : null);
      this._animateCardDrawFlight(targetId, count, true, drawnCards);

      const seat = document.getElementById(`seat-${targetId}`);
      if (seat) {
        const rect = seat.getBoundingClientRect();
        const popup = document.createElement('div');
        popup.className = 'splash-damage-popup';
        popup.innerText = `📣 +${count} (${reasonLabel})!`;
        popup.style.left = `${rect.left + 10}px`;
        popup.style.top = `${rect.top - 12}px`;
        document.body.appendChild(popup);
        setTimeout(() => popup.remove(), 1600);
      }
    }

    // -------------------------------------------------------------
    // FLYING CARD & SPECIAL RULE VISUAL EFFECTS
    // -------------------------------------------------------------

    playActionEffects(lastAction, prevRoom, newRoom) {
      if (!lastAction) return;
      if (prevRoom && prevRoom.last_action && prevRoom.last_action.seq === lastAction.seq) {
        return;
      }

      switch (lastAction.type) {
        case 'DEAL':
          audio.play('card_slide');
          this._animateDeal(newRoom);
          break;
        case 'DRAW':
        case 'DRAW_UNTIL': {
          audio.play('draw');
          const drawnCards =
            lastAction.drawn_cards || (lastAction.card ? [lastAction.card] : null);
          this._animateCardDrawFlight(
            lastAction.actor_id,
            lastAction.count || 1,
            false,
            drawnCards
          );
          break;
        }
        case 'PLAY':
          audio.play('card_snap');
          this._animateCardPlayFlight(lastAction);
          break;
        case 'SKIP':
          audio.play('skip');
          this._animateCardPlayFlight(lastAction);
          break;
        case 'REVERSE':
          audio.play('reverse');
          this._animateCardPlayFlight(lastAction);
          this._animateReverse();
          break;
        case 'STACK_TWO':
          audio.play('penalty_impact');
          this._animateCardPlayFlight(lastAction);
          this._screenShake();
          break;
        case 'INTERCEPT_TWO':
          audio.play('intercept');
          this._animateCardPlayFlight(lastAction);
          this._screenShake();
          break;
        case 'WILD':
          audio.play('card_snap');
          this._animateCardPlayFlight(lastAction);
          this._animateWildPrism(lastAction.chosen_suit);
          break;
        case 'VERBAL_PENALTY':
          this.playRefereeWhistleEffect(lastAction);
          break;
        case 'WIN':
          audio.play('win');
          this._triggerConfetti();
          break;
      }

      if (
        lastAction.splash_target_ids &&
        lastAction.splash_target_ids.length > 0
      ) {
        this._animateSplashDamage(lastAction.splash_target_ids);
      }
    }

    _animateCardPlayFlight(lastAction) {
      const vfx = document.getElementById('vfx-layer');
      const discardEl = document.getElementById('discard-stack');
      if (!vfx || !discardEl || !lastAction) return;

      const seatEl = document.getElementById(`seat-${lastAction.actor_id}`);
      if (!seatEl) return; // Local player already dragged or clicked directly

      const sRect = seatEl.getBoundingClientRect();
      const dRect = discardEl.getBoundingClientRect();
      const cards =
        Array.isArray(lastAction.cards) && lastAction.cards.length > 0
          ? lastAction.cards
          : [];

      cards.forEach((c, idx) => {
        setTimeout(() => {
          const isRed = c.suit === 'H' || c.suit === 'D';
          const r = getRankStr(c.rank);
          const s = SUIT_SYMBOLS[c.suit] || '♠';
          const fly = document.createElement('div');
          fly.className = `table-card ${isRed ? 'red' : 'black'} flying-card`;
          fly.innerHTML = `
            <div class="card-corner top"><span>${r}</span><span>${s}</span></div>
            <div class="card-center-pip">${s}</div>
            <div class="card-corner bottom"><span>${r}</span><span>${s}</span></div>
          `;
          fly.style.left = `${sRect.left + sRect.width / 2 - 38}px`;
          fly.style.top = `${sRect.top + sRect.height / 2 - 55}px`;
          fly.style.transform = 'scale(0.65) rotate(-14deg)';
          vfx.appendChild(fly);

          requestAnimationFrame(() => {
            const fanOffset = (idx - (cards.length - 1) / 2) * 18;
            fly.style.left = `${dRect.left + fanOffset}px`;
            fly.style.top = `${dRect.top}px`;
            fly.style.transform = `scale(1) rotate(${
              (idx - (cards.length - 1) / 2) * 10
            }deg)`;
          });

          setTimeout(() => fly.remove(), 480);
        }, idx * 55);
      });
    }

    _animateCardDrawFlight(
      targetPlayerId,
      count = 1,
      isRefereePenalty = false,
      drawnCards = null
    ) {
      const vfx = document.getElementById('vfx-layer');
      const drawEl = document.getElementById('draw-pile-card');
      if (!vfx || !drawEl) return;

      const oppSeat = document.getElementById(`seat-${targetPlayerId}`);
      const handTrack = document.getElementById('hand-fan-track');
      const isLocalDraw = !oppSeat && Boolean(handTrack);
      const destEl = oppSeat || handTrack;
      if (!destEl) return;

      const sRect = drawEl.getBoundingClientRect();
      const dRect = destEl.getBoundingClientRect();
      const cardsList =
        isLocalDraw && Array.isArray(drawnCards) && drawnCards.length > 0
          ? drawnCards.slice(0, 6)
          : null;
      const num = cardsList ? cardsList.length : Math.min(6, Math.max(1, count));

      // If local player drew known card(s), temporarily hide them in the hand fan until they glide in
      const hiddenWrappers = [];
      if (cardsList && handTrack) {
        cardsList.forEach((c) => {
          const w = handTrack.querySelector(`.hand-card-wrapper[data-card-id="${c.id}"]`);
          if (w) {
            w.style.opacity = '0';
            hiddenWrappers.push({ card: c, el: w });
          }
        });
      }

      for (let i = 0; i < num; i++) {
        const drawnCardObj = cardsList ? cardsList[i] : null;
        const targetWrapper =
          hiddenWrappers.find((hw) => hw.card && hw.card.id === (drawnCardObj && drawnCardObj.id))
            ?.el || null;

        setTimeout(() => {
          const fly = document.createElement('div');
          if (drawnCardObj) {
            const isRed = drawnCardObj.suit === 'H' || drawnCardObj.suit === 'D';
            const r = getRankStr(drawnCardObj.rank);
            const s = SUIT_SYMBOLS[drawnCardObj.suit] || '♠';
            const specialTag =
              drawnCardObj.rank === 8
                ? 'WILD'
                : drawnCardObj.rank === 2
                ? '+2'
                : drawnCardObj.rank === 7
                ? 'REV'
                : drawnCardObj.rank === 12
                ? 'SKIP'
                : '';
            fly.className = `table-card ${isRed ? 'red' : 'black'} flying-card drawn-reveal-card`;
            fly.innerHTML = `
              <div class="drawn-card-banner">${isRefereePenalty ? '📣 PENALTY' : '✨ DREW'} ${r}${s}</div>
              <div class="card-corner top"><span>${r}</span><span>${s}</span></div>
              <div class="card-center-pip">${s}</div>
              ${specialTag ? `<div class="card-special-ribbon">${specialTag}</div>` : ''}
              <div class="card-corner bottom"><span>${r}</span><span>${s}</span></div>
            `;
          } else {
            fly.className =
              'table-card card-back flying-card' +
              (isRefereePenalty ? ' referee-penalty-card' : '');
            fly.innerHTML = `<span class="draw-pile-text">${
              isRefereePenalty ? '📣+1' : '🂠'
            }</span>`;
          }

          fly.style.left = `${sRect.left}px`;
          fly.style.top = `${sRect.top}px`;
          fly.style.transform = 'scale(0.85) rotate(-8deg)';
          fly.style.transition = 'all 0.34s cubic-bezier(0.22, 1, 0.36, 1)';
          vfx.appendChild(fly);

          // Stage 1: Reveal & Show the Drawn Card above the Stock pile
          requestAnimationFrame(() => {
            const offsetSpread = (i - (num - 1) / 2) * 28;
            fly.style.left = `${sRect.left + offsetSpread}px`;
            fly.style.top = `${sRect.top - (isLocalDraw ? 26 : 12)}px`;
            fly.style.transform = isLocalDraw
              ? 'scale(1.22) rotate(0deg)'
              : 'scale(1.04) rotate(0deg)';
          });

          // Stage 2: Move the Card into its exact slot in the Hand (or Opponent Seat)
          const revealHoldMs = isLocalDraw ? 380 : 180;
          setTimeout(() => {
            fly.style.transition = 'all 0.38s cubic-bezier(0.22, 1, 0.36, 1)';
            if (targetWrapper) {
              const tRect = targetWrapper.getBoundingClientRect();
              const targetCardEl = targetWrapper.querySelector('.table-card') || targetWrapper;
              const cRect = targetCardEl.getBoundingClientRect();
              fly.style.left = `${cRect.left}px`;
              fly.style.top = `${cRect.top}px`;
              fly.style.transform = 'scale(1) rotate(0deg)';
            } else {
              fly.style.left = `${dRect.left + dRect.width / 2 - 38}px`;
              fly.style.top = `${dRect.top + dRect.height / 2 - 55}px`;
              fly.style.transform = isLocalDraw
                ? 'scale(0.95) rotate(0deg)'
                : 'scale(0.6) rotate(12deg)';
              if (!isLocalDraw) fly.style.opacity = '0.25';
            }
          }, revealHoldMs);

          // Stage 3: Finalize and reveal the card inside the hand
          setTimeout(() => {
            if (targetWrapper) {
              targetWrapper.style.opacity = '1';
              targetWrapper.classList.add('newly-drawn-highlight');
              setTimeout(() => targetWrapper.classList.remove('newly-drawn-highlight'), 900);
            }
            fly.remove();
          }, revealHoldMs + 390);
        }, i * 110);
      }
    }

    _animateDeal() {
      const vfx = document.getElementById('vfx-layer');
      const drawEl = document.getElementById('draw-pile-card');
      if (!vfx || !drawEl) return;

      const dRect = drawEl.getBoundingClientRect();
      if (dRect.width === 0 && dRect.height === 0) return;

      for (let i = 0; i < 6; i++) {
        setTimeout(() => {
          const card = document.createElement('div');
          card.className = 'table-card card-back flying-card';
          card.style.left = `${dRect.left}px`;
          card.style.top = `${dRect.top}px`;
          card.style.transform = 'scale(0.85)';
          vfx.appendChild(card);

          requestAnimationFrame(() => {
            card.style.left = `${dRect.left + (i - 2.5) * 35}px`;
            card.style.top = `${dRect.top + 140}px`;
            card.style.opacity = '0';
            card.style.transform = 'scale(0.6) rotate(10deg)';
          });

          setTimeout(() => card.remove(), 520);
        }, i * 60);
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
      table.offsetHeight;
      table.style.animation = 'shake-table 0.4s ease-in-out';
      setTimeout(() => (table.style.animation = ''), 400);
    }

    _animateWildPrism() {
      const glow = document.getElementById('active-suit-box');
      if (glow) {
        glow.style.transform = 'scale(1.25)';
        setTimeout(() => (glow.style.transform = 'scale(1)'), 400);
      }
    }

    _animateSplashDamage(targetIds) {
      targetIds.forEach((id) => {
        this._animateCardDrawFlight(id, 1, false);
        const seat = document.getElementById(`seat-${id}`);
        if (!seat) return;
        const rect = seat.getBoundingClientRect();
        const popup = document.createElement('div');
        popup.className = 'splash-damage-popup';
        popup.innerText = '⚡ +1 STREAK PENALTY!';
        popup.style.left = `${rect.left + 10}px`;
        popup.style.top = `${rect.top - 10}px`;
        document.body.appendChild(popup);
        setTimeout(() => popup.remove(), 1300);
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
        conf.style.background = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6'][
          Math.floor(Math.random() * 4)
        ];
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
