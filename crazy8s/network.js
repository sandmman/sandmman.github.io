/**
 * Crazy 8s Multi-Transport Cross-Computer Network Layer
 * Transports (all active in parallel with automatic _msgId deduplication):
 *   1. Port-443 MQTT over WSS (wss://public.cloud.shiftr.io:443/mqtt + EMQX/HiveMQ)
 *   2. Port-443 HTTPS/WSS Native Pub/Sub Relay (ntfy.sh WSS + SSE + HTTPS POST)
 *   3. WebRTC DataChannels via PeerJS (0.peerjs.com:443 + Google/Cloudflare STUN)
 *   4. Same-Browser BroadcastChannel + localStorage storage events
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

  // Fast, reachable STUN servers only (dead openrelay.metered.ca removed so ICE never stalls)
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  // Primary broker uses standard Port 443 so corporate/campus firewalls never block it
  const WSS_BROKERS = [
    {
      url: 'wss://public.cloud.shiftr.io:443/mqtt',
      options: { username: 'public', password: 'public' },
    },
    {
      url: 'wss://broker.emqx.io:8084/mqtt',
      options: {},
    },
    {
      url: 'wss://broker.hivemq.com:8884/mqtt',
      options: {},
    },
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

      // Port-443 WSS & HTTPS Cloud Relays
      this.wssClients = [];
      this.wssTopic = null;
      this.ntfyTopic = null;
      this.ntfyWs = null;
      this.ntfySse = null;
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

    _setupNtfyRelay(roomId) {
      const roomKey = roomId.toLowerCase();
      this.ntfyTopic = `c8_sandmman_v3_${roomKey}`;

      if (this.ntfyWs) {
        try {
          this.ntfyWs.close();
        } catch (e) {}
        this.ntfyWs = null;
      }
      if (this.ntfySse) {
        try {
          this.ntfySse.close();
        } catch (e) {}
        this.ntfySse = null;
      }

      const handleNtfyEvent = (rawText) => {
        try {
          const wrapper = JSON.parse(rawText);
          if (wrapper && wrapper.event === 'message' && wrapper.message) {
            const msg = JSON.parse(wrapper.message);
            if (!msg || msg.senderId === this.myPlayerId) return;
            this._handleIncomingMessage(msg);
          }
        } catch (e) {}
      };

      // 1. Native Port-443 WebSocket stream (wss://ntfy.sh/.../ws)
      if (typeof WebSocket !== 'undefined') {
        try {
          const ws = new WebSocket(`wss://ntfy.sh/${this.ntfyTopic}/ws`);
          ws.onopen = () => {
            if (!this.isHost && !this.hasSynced && typeof this._sendJoinRequest === 'function') {
              this._sendJoinRequest();
            }
          };
          ws.onmessage = (evt) => handleNtfyEvent(evt.data);
          this.ntfyWs = ws;
        } catch (e) {}
      }

      // 2. Native Port-443 Server-Sent Events stream (https://ntfy.sh/.../sse)
      if (typeof EventSource !== 'undefined') {
        try {
          const sse = new EventSource(`https://ntfy.sh/${this.ntfyTopic}/sse`);
          sse.onmessage = (evt) => handleNtfyEvent(evt.data);
          this.ntfySse = sse;
        } catch (e) {}
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

      this.wssTopic = `crazy8s/sandmman/v3/${roomId.toLowerCase()}`;

      if (typeof mqtt === 'undefined') {
        console.warn('[WSS] MQTT.js client library not available on page');
        return;
      }

      WSS_BROKERS.forEach((broker) => {
        try {
          const clientId = `c8_${this.myPlayerId}_${Math.random().toString(36).slice(2, 7)}`;
          const client = mqtt.connect(broker.url, {
            ...broker.options,
            clientId: clientId,
            clean: true,
            connectTimeout: 5000,
            reconnectPeriod: 2000,
          });

          client.on('connect', () => {
            console.log(`[WSS] Connected to Cloud Relay: ${broker.url}`);
            client.subscribe(this.wssTopic, { qos: 0 }, (err) => {
              if (!err) {
                if (this.isHost) {
                  this.notifyStatus('HOST_READY', `Hosting Room: ${this.roomId}`);
                  // Publish retained room state so late subscribers immediately discover the room
                  this._broadcastRoomState();
                } else if (!this.hasSynced && typeof this._sendJoinRequest === 'function') {
                  this._sendJoinRequest();
                }
              }
            });
          });

          client.on('message', (topic, payload) => {
            if (topic !== this.wssTopic) return;
            try {
              const text =
                typeof payload === 'string'
                  ? payload
                  : typeof TextDecoder !== 'undefined'
                  ? new TextDecoder().decode(payload)
                  : payload.toString();
              const msg = JSON.parse(text);
              if (!msg || msg.senderId === this.myPlayerId) return;
              this._handleIncomingMessage(msg);
            } catch (err) {}
          });

          client.on('error', () => {});

          this.wssClients.push(client);
        } catch (e) {}
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
      this._setupNtfyRelay(this.roomId);
      this._setupWssRelay(this.roomId);
      this._initPeerHost(this.roomId);

      const publicState = window.Crazy8Engine.getPublicRoomState(
        this.hostRoom,
        this.myPlayerId
      );
      if (this.onStateUpdate) {
        this.onStateUpdate(publicState);
      }

      return {
        roomId: this.roomId,
        playerId: this.myPlayerId,
        room: publicState,
      };
    }

    _initPeerHost(roomId) {
      const fullPeerId = `${PEER_PREFIX}${roomId.toLowerCase()}`;
      this.notifyStatus('HOST_READY', `Hosting Room: ${roomId}`);

      if (typeof Peer === 'undefined') {
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

        this.peer.on('open', () => {
          this.notifyStatus('HOST_READY', `Hosting Room: ${roomId}`);
        });

        this.peer.on('connection', (conn) => {
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

          conn.on('error', () => {});
        });

        this.peer.on('error', () => {
          this.notifyStatus('HOST_READY', `Hosting Room: ${roomId}`);
        });
      } catch (e) {}
    }

    // -------------------------------------------------------------
    // CLIENT / PEER MODE
    // -------------------------------------------------------------

    joinRoom(rawRoomId, playerName, existingPlayerId = null) {
      this.isHost = false;
      // Extract clean room code even if user pasted a full invite URL
      const match = String(rawRoomId || '').match(/R\d{4}/i);
      this.roomId = (match ? match[0] : String(rawRoomId || '').trim()).toUpperCase();
      this.myPlayerId =
        existingPlayerId ||
        'p-' +
          Math.random().toString(36).slice(2, 9) +
          '-' +
          Date.now().toString(36).slice(-4);
      this.myPlayerName = playerName || 'Player';
      this.hasSynced = false;

      this._setupBroadcastChannel(this.roomId);
      this._setupNtfyRelay(this.roomId);
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

      // Retry join handshake every 1.2s up to 35 times until Host syncs state
      if (this.joinRetryTimer) clearInterval(this.joinRetryTimer);
      let attempts = 0;
      this.joinRetryTimer = setInterval(() => {
        if (this.hasSynced || attempts >= 35) {
          clearInterval(this.joinRetryTimer);
          this.joinRetryTimer = null;
          return;
        }
        attempts++;
        this._sendJoinRequest();
      }, 1200);

      // Parallel WebRTC DataChannel attempt
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
              this.notifyStatus('PEER_CONNECTED', `Connected to Room ${this.roomId}`);
              this._sendJoinRequest();
            });

            conn.on('data', (data) => {
              this._handleIncomingMessage(data, conn);
            });
          });
        } catch (e) {}
      }

      return { roomId: this.roomId, playerId: this.myPlayerId };
    }

    // -------------------------------------------------------------
    // MESSAGE BUS & RPC HANDLING
    // -------------------------------------------------------------

    _broadcastMessage(msg, options = {}) {
      if (!msg) return;
      if (!msg._msgId) {
        msg._msgId =
          this.myPlayerId +
          '-' +
          Date.now().toString(36) +
          '-' +
          Math.random().toString(36).slice(2, 7);
      }

      const payloadStr = JSON.stringify(msg);

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

      // 3. Port-443 WSS MQTT Cloud Relays (shiftr.io:443 + EMQX + HiveMQ)
      if (this.wssClients && this.wssClients.length > 0 && this.wssTopic) {
        const pubOpts = { qos: 0, retain: !!options.retain };
        this.wssClients.forEach((client) => {
          try {
            if (client.connected) {
              client.publish(this.wssTopic, payloadStr, pubOpts);
            }
          } catch (e) {}
        });
      }

      // 4. Port-443 HTTPS Native Relay (ntfy.sh) for all control, state, and drag-end packets
      if (
        this.ntfyTopic &&
        typeof fetch !== 'undefined' &&
        (msg.type === 'RPC_REQUEST' ||
          msg.type === 'SYNC_STATE' ||
          (msg.type === 'TELEMETRY' && msg.data && msg.data.type === 'DRAG_END'))
      ) {
        try {
          fetch(`https://ntfy.sh/${this.ntfyTopic}`, {
            method: 'POST',
            body: payloadStr,
          }).catch(() => {});
        } catch (e) {}
      }

      // 5. Host WebRTC DataChannels
      for (const conn of this.connections.values()) {
        try {
          if (conn.open) conn.send(msg);
        } catch (e) {}
      }

      // 6. Client WebRTC DataChannel to Host
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
        if (this.seenMsgIds.size > 800) {
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
        if (this.isHost) {
          this._broadcastMessage(msg);
        }
        return;
      }

      if (msg.type === 'SYNC_STATE') {
        if (this.isHost) return;
        if (msg.recipientId && msg.recipientId !== this.myPlayerId) return;

        const rawRoom = msg.rawRoom || msg.room;
        if (!rawRoom) return;

        // Check if this client is already seated in the room roster
        const amISeated =
          Array.isArray(rawRoom.players) &&
          rawRoom.players.some((p) => p.id === this.myPlayerId);

        if (!amISeated) {
          // We received a retained or broadcast room state before our joinRoom was processed;
          // immediately fire joinRoom so the Host adds us and re-broadcasts!
          if (typeof this._sendJoinRequest === 'function') {
            this._sendJoinRequest();
          }
          return;
        }

        if (!this.hasSynced) {
          this.hasSynced = true;
          if (this.joinRetryTimer) {
            clearInterval(this.joinRetryTimer);
            this.joinRetryTimer = null;
          }
          this.notifyStatus('PEER_CONNECTED', `Connected to Room ${this.roomId}`);
        }

        const sanitized =
          msg.rawRoom && window.Crazy8Engine
            ? window.Crazy8Engine.getPublicRoomState(msg.rawRoom, this.myPlayerId)
            : msg.room;

        if (this.onStateUpdate && sanitized) {
          this.onStateUpdate(sanitized);
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
        const botNames = [
          'Bot Watson',
          'Bot Ada',
          'Bot Turing',
          'Bot Pascal',
          'Bot Hopper',
          'Bot Knuth',
          'Bot Lovelace',
        ];
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

      // Update host's own UI
      if (this.onStateUpdate) {
        this.onStateUpdate(E.getPublicRoomState(this.hostRoom, this.myPlayerId));
      }

      // Broadcast single retained SYNC_STATE packet across all transports
      const packet = {
        type: 'SYNC_STATE',
        rawRoom: this.hostRoom,
        senderId: this.myPlayerId,
      };
      this._broadcastMessage(packet, { retain: true });
    }

    _checkBotTurn() {
      if (!this.isHost || !this.hostRoom) return;
      if (this.botTimer) {
        clearInterval(this.botTimer);
        this.botTimer = null;
      }
      if (this.hostRoom.status !== 'PLAYING') return;

      const curPlayer = this.hostRoom.players[this.hostRoom.current_player_index];
      if (!curPlayer || !curPlayer.is_bot) return;

      const plan = window.Crazy8Engine.planBotAction(this.hostRoom);
      if (!plan) return;

      const botSeatIdx = this.hostRoom.current_player_index;
      const botId = curPlayer.id;
      const botName = curPlayer.name;
      let progress = 0;
      const steps = 8;
      const intervalMs = 55;
      this.botSeq = (this.botSeq || 0);

      this.botTimer = setInterval(() => {
        progress += 1 / steps;
        this.botSeq += 1;
        if (progress >= 1) {
          clearInterval(this.botTimer);
          this.botTimer = null;
          this.sendTelemetry({
            type: 'DRAG_END',
            seq: this.botSeq,
            botId: botId,
            botName: botName,
          });
          window.Crazy8Engine.executeBotTurn(this.hostRoom);
          this._broadcastRoomState();
          this._checkBotTurn();
        } else {
          const totalPlayers = this.hostRoom.players.length || 1;
          const angle = (botSeatIdx / totalPlayers) * 2 * Math.PI - Math.PI / 2;
          const startX = 0.5 + 0.35 * Math.cos(angle);
          const startY = 0.5 + 0.35 * Math.sin(angle);
          const curX = startX + (0.5 - startX) * progress;
          const curY = startY + (0.5 - startY) * progress;

          this.sendTelemetry({
            type: 'BOT_DRAG',
            seq: this.botSeq,
            botId: botId,
            botName: botName,
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
