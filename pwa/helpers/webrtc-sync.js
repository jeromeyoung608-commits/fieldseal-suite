/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// ISOLATED HELPER LAYER - pwa/helpers
// Draft-only WebRTC P2P sync. Manual signalling (copy/paste), no signalling server,
// no STUN/TURN by default, no external code. Never used after Seal and never hashed.

const CHANNEL_NAME = 'fieldseal-draft';
const ENVELOPE = 'fieldseal-p2p';

export function createP2PSync(options = {}) {
 const onMessage = options.onMessage || (() => {});
 const onState = options.onState || (() => {});
 const onConflict = options.onConflict || (() => {});
 let peer = null;
 let channel = null;
 let localDirty = false;

 function state(text) { onState(text); }

 function bindChannel(dataChannel) {
 dataChannel.onopen = () => state('DataChannel open');
 dataChannel.onclose = () => state('DataChannel geschlossen');
 dataChannel.onmessage = (event) => {
 try {
 const message = JSON.parse(event.data);
 if (localDirty) { onConflict(message); }
 else { onMessage(message); localDirty = false; }
 } catch (error) { /* ignore malformed draft message */ }
 };
 }

 function waitForIceGathering(connection) {
 return new Promise((resolve) => {
 if (connection.iceGatheringState === 'complete') { resolve(); return; }
 const check = () => {
 if (connection.iceGatheringState === 'complete') {
 connection.removeEventListener('icegatheringstatechange', check);
 resolve();
 }
 };
 connection.addEventListener('icegatheringstatechange', check);
 setTimeout(() => {
 connection.removeEventListener('icegatheringstatechange', check);
 resolve();
 }, 5000);
 });
 }

 function close() {
 if (channel) { try { channel.close(); } catch (error) { /* already closed */ } }
 if (peer) { try { peer.close(); } catch (error) { /* already closed */ } }
 channel = null;
 peer = null;
 }

 function connection() {
 if (typeof RTCPeerConnection === 'undefined') {
 throw new Error('WebRTC not available - use offline mode / WebRTC unavailable, use offline fallback');
 }
 return new RTCPeerConnection({ iceServers: [] });
 }

 async function createOffer() {
 close();
 peer = connection();
 channel = peer.createDataChannel(CHANNEL_NAME);
 bindChannel(channel);
 peer.onconnectionstatechange = () => state('Peer: ' + peer.connectionState);
 await peer.setLocalDescription(await peer.createOffer());
 state('Sammle ICE-Kandidaten');
 await waitForIceGathering(peer);
 state('Invitation created');
 return JSON.stringify({ kind: ENVELOPE, type: 'offer', description: peer.localDescription });
 }

 async function acceptOffer(text) {
 const envelope = JSON.parse(text);
 if (envelope.kind !== ENVELOPE || envelope.type !== 'offer') throw new Error('None gueltige Invitation / invalid offer');
 close();
 peer = connection();
 peer.ondatachannel = (event) => { channel = event.channel; bindChannel(channel); };
 peer.onconnectionstatechange = () => state('Peer: ' + peer.connectionState);
 await peer.setRemoteDescription(envelope.description);
 await peer.setLocalDescription(await peer.createAnswer());
 state('Sammle ICE-Kandidaten');
 await waitForIceGathering(peer);
 state('Response created');
 return JSON.stringify({ kind: ENVELOPE, type: 'answer', description: peer.localDescription });
 }

 async function acceptAnswer(text) {
 const envelope = JSON.parse(text);
 if (envelope.kind !== ENVELOPE || envelope.type !== 'answer') throw new Error('None gueltige Response / invalid answer');
 if (!peer) throw new Error('Create an invitation first');
 await peer.setRemoteDescription(envelope.description);
 state('Response applied');
 }

 function send(payload) {
 if (!channel || channel.readyState !== 'open') {
 state('DataChannel not open - message not sent');
 return false;
 }
 channel.send(JSON.stringify(payload));
 localDirty = false;
 return true;
 }

 function markLocalEdit() {
 localDirty = true;
 }

 return {
 createOffer, acceptOffer, acceptAnswer, send, close, markLocalEdit,
 get connected() { return Boolean(channel && channel.readyState === 'open'); }
 };
}
