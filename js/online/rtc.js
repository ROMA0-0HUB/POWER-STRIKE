// Peer-to-peer mesh (WebRTC data channels). Every human player links directly to
// every other human. Firebase is used only for the connection handshake.
//   'st' channel: unordered, no retransmits -> frequent player/ball state (newest wins)
//   'ev' channel: ordered and reliable      -> kicks, ownership changes, match events
const RTC_CONFIG = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};

export class RtcHub {
  /** signal.send(toUid, msg) and signal.watch(cb) -> off; msg = {kind, data, from}. */
  constructor({ myUid, signal }) {
    this.myUid = myUid;
    this.signal = signal;
    this.peers = new Map();   // uid -> { pc, st, ev, pending: [], ready }
    this.stateH = new Set();
    this.eventH = new Set();
    this.lastHeard = {};      // uid -> ms of the last message from that peer
    this._onReady = null;
    this.off = signal.watch((msg) => this._onSignal(msg).catch((e) => console.warn('rtc signal', e)));
  }

  /** Resolves when every listed peer is connected. The smaller uid initiates each pair. */
  connect(peerUids, timeoutMs = 25000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('تعذر الاتصال المباشر بين اللاعبين. تحقق من الإنترنت أو جرّب شبكة ثانية')), timeoutMs);
      this._onReady = () => {
        if (peerUids.every((u) => this.peers.get(u)?.ready)) { clearTimeout(timer); resolve(this); }
      };
      for (const uid of peerUids) {
        if (this.myUid < uid) this._createOffer(uid).catch((e) => { clearTimeout(timer); reject(e); });
      }
      this._onReady();
    });
  }

  _peer(uid) {
    let peer = this.peers.get(uid);
    if (peer) return peer;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peer = { pc, st: null, ev: null, pending: [], ready: false };
    this.peers.set(uid, peer);
    pc.onicecandidate = (e) => { if (e.candidate) this.signal.send(uid, { kind: 'ice', data: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { peer.ready = false; console.warn('rtc failed', uid); } };
    pc.ondatachannel = (e) => this._bind(uid, e.channel);
    return peer;
  }

  async _createOffer(uid) {
    const peer = this._peer(uid);
    this._bind(uid, peer.pc.createDataChannel('st', { ordered: false, maxRetransmits: 0 }));
    this._bind(uid, peer.pc.createDataChannel('ev', { ordered: true }));
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    this.signal.send(uid, { kind: 'offer', data: peer.pc.localDescription.toJSON() });
  }

  _bind(uid, ch) {
    const peer = this.peers.get(uid);
    if (ch.label === 'st') peer.st = ch; else peer.ev = ch;
    ch.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (_) { return; }
      this.lastHeard[uid] = Date.now();
      if (ch.label === 'st') this.stateH.forEach((h) => h(m, uid));
      else this.eventH.forEach((h) => h(m, uid));
    };
    ch.onopen = () => {
      if (peer.st?.readyState === 'open' && peer.ev?.readyState === 'open') { peer.ready = true; this._onReady?.(); }
    };
  }

  async _onSignal(msg) {
    const uid = msg.from;
    if (!uid || uid === this.myUid) return;
    const { kind, data } = msg;
    if (kind === 'offer') {
      const peer = this._peer(uid);
      await peer.pc.setRemoteDescription(data);
      await this._flush(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this.signal.send(uid, { kind: 'answer', data: peer.pc.localDescription.toJSON() });
    } else if (kind === 'answer') {
      const peer = this.peers.get(uid);
      if (!peer) return;
      await peer.pc.setRemoteDescription(data);
      await this._flush(peer);
    } else if (kind === 'ice') {
      const peer = this._peer(uid);
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data).catch(() => {});
      else peer.pending.push(data);
    }
  }

  async _flush(peer) { for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {}); }

  /** Send to every connected peer (state: newest wins). */
  sendState(obj) {
    const s = JSON.stringify(obj);
    for (const p of this.peers.values()) if (p.st?.readyState === 'open') p.st.send(s);
  }

  /** Send to every connected peer (events: reliable and ordered). */
  sendEvent(obj) {
    const s = JSON.stringify(obj);
    for (const p of this.peers.values()) if (p.ev?.readyState === 'open') p.ev.send(s);
  }

  onState(h) { this.stateH.add(h); return () => this.stateH.delete(h); }
  onEvent(h) { this.eventH.add(h); return () => this.eventH.delete(h); }

  status() {
    return [...this.peers.entries()].map(([u, p]) => `${u.slice(0, 5)}:${p.ready ? 'ok' : 'wait'}`).join(' ') || 'no peers';
  }

  close() {
    this.off?.();
    for (const p of this.peers.values()) { try { p.pc.close(); } catch (_) {} }
    this.peers.clear();
  }
}
