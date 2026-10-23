/**
 * Crazy 8s WebRTC P2P Network Layer (PeerJS + BroadcastChannel)
 * Exposes window.Crazy8Network
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Crazy8Network = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PEER_PREFIX = 'crazy8s-sandmman-';

  class NetworkController {
    constructor() {
      this.isHost = false;
      this.roomId = null;
      this.myPlayerId = null;
      this.myPlayerName = null;
      this.peer = null;
      this.connections = new Map(); // peerId -> DataConnection
      this.broadcastChannel = null;
      this.hostConnection = null;

      // Host State
      this.hostRoom = null;
      this.botTimer = null;

      // Callbacks
      this.onStateUpdate = null;
      this.onRemoteTelemetry = null;
      this.onConnectionStatus = null;
    }

    notifyStatus(status, detail) {
      if (typeof this.onConnectionStatus === 'function') {
        this.onConnectionStatus(status, detail);
      }
    }

    _setupBroadcastChannel(roomId) {
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          if (this.broadcastChannel) this.broadcastChannel.close();
          this.broadcastChannel = new BroadcastChannel(`crazy8s_room_${roomId.toLowerCase()}`);
          this.broadcastChannel.onmessage = (evt) => {
            const msg = evt.data;
            if (!msg || msg.senderId === this.myPlayerId) return;
            this._handleIncomingMessage(msg);
          };
        } catch (e) {
          console.warn('[BC] BroadcastChannel failed to init:', e);
        }
      }
    }

    // -------------------------------------------------------------
    // HOST MODE
    // -------------------------------------------------------------

    createRoom(hostName) {
      this.isHost = true;
      this.roomId = 'R' + Math.floor(1000 + Math.random() * 9000);
      this.myPlayerId = 'p_' + Math.random().toString(36).substr(2, 9);
      this.myPlayerName = hostName || 'Host';

      this.hostRoom = window.Crazy8Engine.createRoom(
        this.roomId,
        this.myPlayerId,
        this.myPlayerName
      );

      this._setupBroadcastChannel(this.roomId);
      this._initPeerHost(this.roomId);

      if (this.onStateUpdate) {
        this.onStateUpdate(
          window.Crazy8Engine.getPublicRoomState(this.hostRoom, this.myPlayerId)
        );
      }

      return {
        roomId: this.roomId,
        playerId: this.myPlayerId,
        room: window.Crazy8Engine.getPublicRoomState(this.hostRoom, this.myPlayerId),
      };
    }

    _initPeerHost(roomId) {
      const fullPeerId = `${PEER_PREFIX}${roomId.toLowerCase()}`;
      this.notifyStatus('CONNECTING', 'Registering WebRTC Peer...');

      if (typeof Peer === 'undefined') {
        this.notifyStatus('LOCAL_ONLY', 'PeerJS not available, running via BroadcastChannel');
        return;
      }

      try {
        this.peer = new Peer(fullPeerId, {
          debug: 1,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' },
            ],
          },
        });

        this.peer.on('open', (id) => {
          this.notifyStatus('HOST_READY', `Hosting P2P Room: ${roomId}`);
        });

        this.peer.on('connection', (conn) => {
          conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            this.notifyStatus('PEER_CONNECTED', `Peer joined: ${conn.peer}`);
          });

          conn.on('data', (data) => {
            this._handleIncomingMessage(data, conn);
          });

          conn.on('close', () => {
            this.connections.delete(conn.peer);
          });
        });

        this.peer.on('error', (err) => {
          console.warn('[PeerJS Host Error]:', err);
          if (err.type === 'unavailable-id') {
            this.notifyStatus('HOST_READY', `Room ${roomId} active (ID conflict fallback to BC)`);
          } else {
            this.notifyStatus('WARN', err.type || err.message);
          }
        });
      } catch (e) {
        console.warn('[PeerJS Init Error]:', e);
      }
    }

    // -------------------------------------------------------------
    // CLIENT / PEER MODE
    // -------------------------------------------------------------

    joinRoom(roomId, playerName, existingPlayerId = null) {
      this.isHost = false;
      this.roomId = roomId.toUpperCase();
      this.myPlayerId = existingPlayerId || 'p_' + Math.random().toString(36).substr(2, 9);
      this.myPlayerName = playerName || 'Player';

      this._setupBroadcastChannel(this.roomId);
      this.notifyStatus('CONNECTING', `Connecting to Room ${this.roomId}...`);

      // First broadcast a local discovery in case Host is in another tab
      this._broadcastMessage({
        type: 'RPC_REQUEST',
        action: 'joinRoom',
        payload: { roomId: this.roomId, playerName: this.myPlayerName },
        senderId: this.myPlayerId,
      });

      // Also connect via PeerJS
      if (typeof Peer !== 'undefined') {
        const myPeerId = `client-${this.myPlayerId}`;
        const targetHostPeerId = `${PEER_PREFIX}${this.roomId.toLowerCase()}`;

        try {
          this.peer = new Peer(myPeerId, {
            debug: 1,
            config: {
              iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' },
              ],
            },
          });

          this.peer.on('open', () => {
            const conn = this.peer.connect(targetHostPeerId, { reliable: true });
            this.hostConnection = conn;

            conn.on('open', () => {
              this.notifyStatus('PEER_CONNECTED', `Connected to Host via WebRTC`);
              conn.send({
                type: 'RPC_REQUEST',
                action: 'joinRoom',
                payload: { roomId: this.roomId, playerName: this.myPlayerName },
                senderId: this.myPlayerId,
              });
            });

            conn.on('data', (data) => {
              this._handleIncomingMessage(data, conn);
            });

            conn.on('error', (err) => {
              console.warn('[Client Conn Error]:', err);
            });
          });

          this.peer.on('error', (err) => {
            console.warn('[Client Peer Error]:', err);
          });
        } catch (e) {
          console.warn('[Client PeerJS Init Error]:', e);
        }
      }

      return { roomId: this.roomId, playerId: this.myPlayerId };
    }

    // -------------------------------------------------------------
    // MESSAGE BUS & RPC HANDLING
    // -------------------------------------------------------------

    _broadcastMessage(msg) {
      if (this.broadcastChannel) {
        try {
          this.broadcastChannel.postMessage(msg);
        } catch (e) {}
      }
      for (const conn of this.connections.values()) {
        try {
          if (conn.open) conn.send(msg);
        } catch (e) {}
      }
      if (this.hostConnection && this.hostConnection.open) {
        try {
          this.hostConnection.send(msg);
        } catch (e) {}
      }
    }

    sendAction(action, payload = {}) {
      if (this.isHost) {
        return this.executeHostAction(action, { ...payload, playerId: this.myPlayerId });
      }
      // Send to Host
      const msg = {
        type: 'RPC_REQUEST',
        action: action,
        payload: { ...payload, roomId: this.roomId },
        senderId: this.myPlayerId,
      };
      this._broadcastMessage(msg);
      return { ok: true, pending: true };
    }

    sendTelemetry(data) {
      const msg = {
        type: 'TELEMETRY',
        senderId: this.myPlayerId,
        senderName: this.myPlayerName,
        data: data,
      };
      this._broadcastMessage(msg);
    }

    sendEmote(emoji) {
      this.sendTelemetry({ type: 'EMOTE', emoji: emoji, playerId: this.myPlayerId });
    }

    _handleIncomingMessage(msg, conn) {
      if (!msg || !msg.type) return;

      if (msg.type === 'TELEMETRY') {
        if (msg.senderId !== this.myPlayerId && this.onRemoteTelemetry) {
          this.onRemoteTelemetry(msg);
        }
        // If Host, relay telemetry to all other connected peers
        if (this.isHost) {
          for (const [peerId, otherConn] of this.connections.entries()) {
            if (conn && otherConn === conn) continue;
            try {
              if (otherConn.open) otherConn.send(msg);
            } catch (e) {}
          }
          if (this.broadcastChannel) {
            try {
              this.broadcastChannel.postMessage(msg);
            } catch (e) {}
          }
        }
        return;
      }

      if (msg.type === 'SYNC_STATE') {
        if (this.onStateUpdate && msg.room) {
          this.onStateUpdate(msg.room);
        }
        return;
      }

      if (msg.type === 'RPC_REQUEST' && this.isHost) {
        const action = msg.action;
        const payload = msg.payload || {};
        payload.playerId = payload.playerId || msg.senderId;
        this.executeHostAction(action, payload);
      }
    }

    // -------------------------------------------------------------
    // HOST ENGINE EXECUTION & STATE BROADCASTING
    // -------------------------------------------------------------

    executeHostAction(action, payload) {
      if (!this.isHost || !this.hostRoom) return { ok: false, error: 'Not host' };
      const E = window.Crazy8Engine;
      const room = this.hostRoom;
      const playerId = payload.playerId || this.myPlayerId;
      let res = { ok: false, error: 'Unknown action' };

      if (action === 'joinRoom') {
        res = E.addPlayer(room, playerId, payload.playerName, false);
      } else if (action === 'addBot') {
        const botNames = ['Bot Watson', 'Bot Ada', 'Bot Turing', 'Bot Pascal', 'Bot Hopper', 'Bot Knuth', 'Bot Lovelace'];
        const bName = payload.botName || botNames[room.players.length % botNames.length];
        const botId = 'bot_' + Math.random().toString(36).substr(2, 9);
        res = E.addPlayer(room, botId, bName, true);
      } else if (action === 'removePlayer') {
        res = E.removePlayer(room, payload.targetPlayerId || playerId);
      } else if (action === 'startGame') {
        res = E.startGame(room);
      } else if (action === 'playCards') {
        res = E.playCards(room, playerId, payload.cardIds, payload.chosenSuit);
      } else if (action === 'drawCard') {
        res = E.drawCard(room, playerId);
      } else if (action === 'drawUntilPlayable') {
        res = E.drawUntilPlayable(room, playerId);
      } else if (action === 'chooseSuit') {
        res = E.chooseSuit(room, playerId, payload.suit);
      }

      this._broadcastRoomState();
      this._checkBotTurn();
      return res;
    }

    _broadcastRoomState() {
      if (!this.isHost || !this.hostRoom) return;
      const E = window.Crazy8Engine;

      // Broadcast to host's own UI
      if (this.onStateUpdate) {
        this.onStateUpdate(E.getPublicRoomState(this.hostRoom, this.myPlayerId));
      }

      // Broadcast sanitized state to each player
      this.hostRoom.players.forEach((p) => {
        if (p.is_bot || p.id === this.myPlayerId) return;
        const pState = E.getPublicRoomState(this.hostRoom, p.id);
        const packet = { type: 'SYNC_STATE', room: pState, recipientId: p.id };
        this._broadcastMessage(packet);
      });
    }

    _checkBotTurn() {
      if (!this.isHost || !this.hostRoom) return;
      if (this.hostRoom.status !== 'PLAYING') return;

      const curPlayer = this.hostRoom.players[this.hostRoom.current_player_index];
      if (!curPlayer || !curPlayer.is_bot) return;

      if (this.botTimer) clearTimeout(this.botTimer);

      const plan = window.Crazy8Engine.planBotAction(this.hostRoom);
      if (!plan) return;

      // Paced Bot Gesture: Emit simulated drag telemetry over 650ms so humans see the bot drag!
      const botSeatIdx = this.hostRoom.current_player_index;
      let progress = 0;
      const steps = 10;
      const intervalMs = 60;

      const dragInterval = setInterval(() => {
        progress += 1 / steps;
        if (progress >= 1) {
          clearInterval(dragInterval);
          // Commit bot turn
          window.Crazy8Engine.executeBotTurn(this.hostRoom);
          this._broadcastRoomState();
          this._checkBotTurn(); // Next turn check
        } else {
          // Emit synthetic drag trajectory toward center discard pile
          this.sendTelemetry({
            type: 'BOT_DRAG',
            botId: curPlayer.id,
            botName: curPlayer.name,
            seatIndex: botSeatIdx,
            target: plan.target || 'discard',
            progress: progress,
          });
        }
      }, intervalMs);
    }
  }

  return new NetworkController();
});
