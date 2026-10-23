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

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ];

  const WSS_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
  ];

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

      // WSS Cloud Relay Fallback
      this.wssClients = [];
      this.wssTopic = null;
      this.seenMsgIds = new Set();

      // Host State
      this.hostRoom = null;
      this.botTimer = null;
      this.hasSynced = false;
      this.joinRetryTimer = null;
      this._storageListener = null;
      this._sendJoinRequest = null;

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
      const roomKey = roomId.toLowerCase();
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          if (this.broadcastChannel) this.broadcastChannel.close();
          this.broadcastChannel = new BroadcastChannel(`crazy8s_room_${roomKey}`);
          this.broadcastChannel.onmessage = (evt) => {
            const msg = evt.data;
            if (!msg || msg.senderId === this.myPlayerId) return;
            this._handleIncomingMessage(msg);
          };
        } catch (e) {
          console.warn('[BC] BroadcastChannel failed to init:', e);
        }
      }

      // Cross-tab fallback via storage events for same-origin tabs
      if (typeof window !== 'undefined' && window.addEventListener) {
        if (this._storageListener) {
          window.removeEventListener('storage', this._storageListener);
        }
        this._storageListener = (e) => {
          if (e.key === `crazy8s_bus_${roomKey}` && e.newValue) {
            try {
              const msg = JSON.parse(e.newValue);
              if (!msg || msg.senderId === this.myPlayerId) return;
              this._handleIncomingMessage(msg);
            } catch (err) {}
          }
        };
        window.addEventListener('storage', this._storageListener);
      }
    }

    _setupWssRelay(roomId) {
      if (this.wssClients && this.wssClients.length > 0) {
        this.wssClients.forEach((client) => {
          try {
            client.end(true);
          } catch (e) {}
        });
        this.wssClients = [];
      }

      this.wssTopic = `crazy8s/sandmman/v2/${roomId.toLowerCase()}`;

      if (typeof mqtt === 'undefined') {
        console.warn('[WSS] MQTT.js client library not available on page');
        return;
      }

      WSS_BROKERS.forEach((brokerUrl) => {
        try {
          const clientId = `c8_${this.myPlayerId}_${Math.random().toString(36).slice(2, 7)}`;
          const client = mqtt.connect(brokerUrl, {
            clientId: clientId,
            clean: true,
            connectTimeout: 6000,
            reconnectPeriod: 2500,
          });

          client.on('connect', () => {
            console.log(`[WSS] Connected to Cloud Relay: ${brokerUrl}`);
            client.subscribe(this.wssTopic, { qos: 0 }, (err) => {
              if (!err) {
                if (this.isHost) {
                  this.notifyStatus('HOST_READY', `Hosting Room: ${this.roomId}`);
                } else if (!this.hasSynced && typeof this._sendJoinRequest === 'function') {
                  this._sendJoinRequest();
                }
              }
            });
          });

          client.on('message', (topic, payload) => {
            if (topic !== this.wssTopic) return;
            try {
              const msg = JSON.parse(payload.toString());
              if (!msg || msg.senderId === this.myPlayerId) return;
              this._handleIncomingMessage(msg);
            } catch (err) {}
          });

          client.on('error', (err) => {
            console.warn(`[WSS] Broker error on ${brokerUrl}:`, err);
          });

          this.wssClients.push(client);
        } catch (e) {
          console.warn(`[WSS] Init error on ${brokerUrl}:`, e);
        }
      });
    }

    // -------------------------------------------------------------
    // HOST MODE
    // -------------------------------------------------------------

    createRoom(hostName, existingPlayerId = null) {
      this.isHost = true;
      this.roomId = 'R' + Math.floor(1000 + Math.random() * 9000);
      this.myPlayerId =
        existingPlayerId ||
        'p-' +
          Math.random().toString(36).slice(2, 9) +
          '-' +
          Date.now().toString(36).slice(-4);
      this.myPlayerName = hostName || 'Host';

      this.hostRoom = window.Crazy8Engine.createRoom(
        this.roomId,
        this.myPlayerId,
        this.myPlayerName
      );

      this._setupBroadcastChannel(this.roomId);
      this._setupWssRelay(this.roomId);
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
        this.notifyStatus('HOST_READY', `Hosting Room: ${roomId} (WSS Cloud Relay active)`);
        return;
      }

      if (this.peer) {
        try {
          this.peer.destroy();
        } catch (e) {}
        this.peer = null;
      }

      try {
        this.peer = new Peer(fullPeerId, {
          debug: 1,
          config: {
            iceServers: ICE_SERVERS,
          },
        });

        this.peer.on('open', (id) => {
          this.notifyStatus('HOST_READY', `Hosting Room: ${roomId}`);
        });

        this.peer.on('connection', (conn) => {
          // Immediately register connection so early data frames find the peer
          this.connections.set(conn.peer, conn);

          conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            this.notifyStatus('PEER_CONNECTED', `Peer joined: ${conn.peer}`);
            this._broadcastRoomState();
          });

          conn.on('data', (data) => {
            this.connections.set(conn.peer, conn);
            this._handleIncomingMessage(data, conn);
          });

          conn.on('close', () => {
            this.connections.delete(conn.peer);
          });

          conn.on('error', (err) => {
            console.warn('[Host Conn Error]:', err);
          });
        });

        this.peer.on('error', (err) => {
          console.warn('[PeerJS Host Error]:', err);
          this.notifyStatus('HOST_READY', `Hosting Room: ${roomId} (Cloud Relay active)`);
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
      this.myPlayerId =
        existingPlayerId ||
        'p-' +
          Math.random().toString(36).slice(2, 9) +
          '-' +
          Date.now().toString(36).slice(-4);
      this.myPlayerName = playerName || 'Player';
      this.hasSynced = false;

      this._setupBroadcastChannel(this.roomId);
      this._setupWssRelay(this.roomId);
      this.notifyStatus('CONNECTING', `Connecting to Room ${this.roomId}...`);

      this._sendJoinRequest = () => {
        if (this.hasSynced) return;
        this._broadcastMessage({
          type: 'RPC_REQUEST',
          action: 'joinRoom',
          payload: { roomId: this.roomId, playerName: this.myPlayerName },
          senderId: this.myPlayerId,
        });
      };

      // Send initial discovery request
      this._sendJoinRequest();

      // Retry join handshake every 800ms up to 45 times (36s) until Host syncs state
      if (this.joinRetryTimer) clearInterval(this.joinRetryTimer);
      let attempts = 0;
      this.joinRetryTimer = setInterval(() => {
        if (this.hasSynced || attempts >= 45) {
          clearInterval(this.joinRetryTimer);
          this.joinRetryTimer = null;
          return;
        }
        attempts++;
        this._sendJoinRequest();
      }, 800);

      // Also connect via PeerJS with TURN relay servers
      if (typeof Peer !== 'undefined') {
        if (this.peer) {
          try {
            this.peer.destroy();
          } catch (e) {}
          this.peer = null;
        }

        const myPeerId = `c8-client-${this.myPlayerId}`;
        const targetHostPeerId = `${PEER_PREFIX}${this.roomId.toLowerCase()}`;

        try {
          this.peer = new Peer(myPeerId, {
            debug: 1,
            config: {
              iceServers: ICE_SERVERS,
            },
          });

          this.peer.on('open', () => {
            const conn = this.peer.connect(targetHostPeerId, {
              reliable: true,
              serialization: 'json',
            });
            this.hostConnection = conn;

            conn.on('open', () => {
              this.notifyStatus('PEER_CONNECTED', `Connected to Host via WebRTC`);
              this._sendJoinRequest();
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
      if (!msg) return;
      if (!msg._msgId) {
        msg._msgId =
          this.myPlayerId +
          '-' +
          Date.now().toString(36) +
          '-' +
          Math.random().toString(36).slice(2, 7);
      }

      // 1. Same-browser BroadcastChannel
      if (this.broadcastChannel) {
        try {
          this.broadcastChannel.postMessage(msg);
        } catch (e) {}
      }

      // 2. Same-browser localStorage fallback
      if (this.roomId && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(
            `crazy8s_bus_${this.roomId.toLowerCase()}`,
            JSON.stringify({ ...msg, _ts: Date.now() + Math.random() })
          );
        } catch (e) {}
      }

      // 3. Port-443 WSS Cloud Relay (cross-device, cross-firewall)
      if (this.wssClients && this.wssClients.length > 0 && this.wssTopic) {
        const payloadStr = JSON.stringify(msg);
        this.wssClients.forEach((client) => {
          try {
            if (client.connected) {
              client.publish(this.wssTopic, payloadStr, { qos: 0 });
            }
          } catch (e) {}
        });
      }

      // 4. Host WebRTC DataChannels
      for (const conn of this.connections.values()) {
        try {
          if (conn.open) conn.send(msg);
        } catch (e) {}
      }

      // 5. Client WebRTC DataChannel to Host
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
      // Host triggers its own onRemoteTelemetry for bot events so the local screen reflects bot gestures
      if (
        this.isHost &&
        this.onRemoteTelemetry &&
        (data.type === 'BOT_DRAG' || (data.type === 'DRAG_END' && data.botId))
      ) {
        this.onRemoteTelemetry({
          senderId: data.botId || this.myPlayerId,
          senderName: data.botName || this.myPlayerName,
          data: data,
        });
      }
    }

    sendEmote(emoji) {
      this.sendTelemetry({ type: 'EMOTE', emoji: emoji, playerId: this.myPlayerId });
    }

    _handleIncomingMessage(msg, conn) {
      if (!msg || !msg.type) return;

      // Packet deduplication across multi-transport arrivals
      if (msg._msgId) {
        if (this.seenMsgIds.has(msg._msgId)) return;
        this.seenMsgIds.add(msg._msgId);
        if (this.seenMsgIds.size > 600) {
          const first = this.seenMsgIds.values().next().value;
          this.seenMsgIds.delete(first);
        }
      }

      if (conn && conn.peer) {
        this.connections.set(conn.peer, conn);
      }

      if (msg.type === 'TELEMETRY') {
        if (msg.senderId !== this.myPlayerId && this.onRemoteTelemetry) {
          this.onRemoteTelemetry(msg);
        }
        // If Host, relay telemetry to all other connected peers across transports
        if (this.isHost) {
          this._broadcastMessage(msg);
        }
        return;
      }

      if (msg.type === 'SYNC_STATE') {
        if (msg.recipientId && msg.recipientId !== this.myPlayerId) return;
        if (!this.isHost && !this.hasSynced) {
          this.hasSynced = true;
          if (this.joinRetryTimer) {
            clearInterval(this.joinRetryTimer);
            this.joinRetryTimer = null;
          }
          this.notifyStatus('PEER_CONNECTED', `Connected to Room ${this.roomId}`);
        }
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
        const packet = {
          type: 'SYNC_STATE',
          room: pState,
          recipientId: p.id,
          senderId: this.myPlayerId,
        };
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
          this.sendTelemetry({
            type: 'DRAG_END',
            botId: curPlayer.id,
            botName: curPlayer.name,
          });
          // Commit bot turn
          window.Crazy8Engine.executeBotTurn(this.hostRoom);
          this._broadcastRoomState();
          this._checkBotTurn(); // Next turn check
        } else {
          // Curved trajectory from bot seat toward center felt (0.5, 0.5)
          const totalPlayers = this.hostRoom.players.length || 1;
          const angle = (botSeatIdx / totalPlayers) * 2 * Math.PI - Math.PI / 2;
          const startX = 0.5 + 0.35 * Math.cos(angle);
          const startY = 0.5 + 0.35 * Math.sin(angle);
          const curX = startX + (0.5 - startX) * progress;
          const curY = startY + (0.5 - startY) * progress;

          // Emit synthetic drag trajectory toward center discard pile
          this.sendTelemetry({
            type: 'BOT_DRAG',
            botId: curPlayer.id,
            botName: curPlayer.name,
            seatIndex: botSeatIdx,
            target: plan.target || 'discard',
            progress: progress,
            v: progress,
            u: 0,
            nx: curX,
            ny: curY,
          });
        }
      }, intervalMs);
    }
  }

  return new NetworkController();
});
