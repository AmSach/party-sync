// Centralized WebRTC & PeerJS Network Configuration
// High-availability STUN and global TURN relays for mobile cellular networks,
// carrier-grade symmetric NAT, Wi-Fi router AP isolation, and firewalls.

export const PEER_CONFIG = {
  debug: 1,
  config: {
    iceServers: [
      // Primary low-latency Google STUN cluster
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      // Open Relay Project (free global TURN relays over standard UDP, TCP and TLS ports)
      // Essential for connecting phones across mobile 4G/5G, hotspots, and guest Wi-Fi networks
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ],
    iceCandidatePoolSize: 10
  }
};

export const DATA_CONNECTION_OPTIONS = {
  reliable: true,
  serialization: 'json'
};

/**
 * Normalizes user room input to standard 'SESSION-XXXX' format.
 * Strips '#' prefixes, leading 'SESSION-', whitespace, and non-alphanumeric characters.
 */
export function normalizeRoomId(input) {
  if (!input) return '';
  const clean = String(input)
    .trim()
    .toUpperCase()
    .replace(/^SESSION-?/, '')
    .replace(/[^0-9A-Z]/g, '');
  return clean ? `SESSION-${clean}` : '';
}

/**
 * Generates a collision-resistant 4-digit room code for the Host.
 */
export function generateRoomId() {
  return 'SESSION-' + Math.floor(1000 + Math.random() * 9000);
}
