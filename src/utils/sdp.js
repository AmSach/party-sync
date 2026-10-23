// High-Fidelity Audio SDP Negotiation for WebRTC
// Configures Opus for broadcast-grade 48kHz Stereo with In-Band FEC enabled.
// Eliminates packet-loss corruption clicks, buffer congestion, and robotic voice compression.

export function configureHighFidelityAudioSDP(sdp) {
  if (!sdp || typeof sdp !== 'string') return sdp;

  let modified = sdp;

  // Locate Opus codec payload type (typically 111)
  const opusMatch = modified.match(/a=rtpmap:(\d+)\s+opus\/48000/i);
  if (opusMatch) {
    const pt = opusMatch[1];
    const fmtpRegex = new RegExp(`a=fmtp:${pt}\\s+([^\\r\\n]+)`, 'i');

    // Broadcast Studio-Grade 320kbps Ultra-Fidelity Stereo Parameters:
    // - stereo=1 / sprop-stereo=1: Discrete 2-channel stereo
    // - maxaveragebitrate=320000: Broadcast pristine 320kbps studio audio (maximum Opus transparency)
    // - maxplaybackrate=48000 / sprop-maxcapturerate=48000: Full 48kHz studio audio spectrum
    // - usedtx=0: Strictly disable DTX so Opus never silences quiet movie dialogue or background ambiance
    // - useinbandfec=1 / packetloss=15: Proactive 15% Forward Error Correction heals dropped Wi-Fi packets
    // - cbr=1: Constant Bitrate eliminates burst congestion and jitter spikes
    // - ptime=20 / minptime=10: 20ms packet pacing prevents router queue overflows
    const studioParams = 'stereo=1;sprop-stereo=1;maxaveragebitrate=320000;maxplaybackrate=48000;sprop-maxcapturerate=48000;usedtx=0;useinbandfec=1;packetloss=15;cbr=1;ptime=20;minptime=10;maxptime=20';

    if (fmtpRegex.test(modified)) {
      modified = modified.replace(fmtpRegex, (match, existing) => {
        const filtered = existing
          .split(';')
          .map(s => s.trim())
          .filter(s => !/^(stereo|sprop-stereo|maxaveragebitrate|maxplaybackrate|sprop-maxcapturerate|usedtx|cbr|useinbandfec|packetloss|ptime|minptime|maxptime)=/i.test(s))
          .join(';');
        return `a=fmtp:${pt} ${filtered ? filtered + ';' : ''}${studioParams}`;
      });
    } else {
      const rtpmapRegex = new RegExp(`(a=rtpmap:${pt}\\s+opus\\/48000\\/[^\\r\\n]+[\\r\\n]+)`, 'i');
      modified = modified.replace(rtpmapRegex, `$1a=fmtp:${pt} ${studioParams}\r\n`);
    }
  }

  return modified;
}

// Automatically monkey-patch RTCPeerConnection once on load
// Ensures all PeerJS and WebRTC calls universally transmit pristine Hi-Fi stereo music
if (typeof window !== 'undefined' && window.RTCPeerConnection) {
  const origSetLocalDescription = window.RTCPeerConnection.prototype.setLocalDescription;
  window.RTCPeerConnection.prototype.setLocalDescription = function (desc) {
    if (desc && desc.sdp) {
      try {
        const modifiedSdp = configureHighFidelityAudioSDP(desc.sdp);
        const newDesc = typeof window.RTCSessionDescription === 'function'
          ? new window.RTCSessionDescription({ type: desc.type, sdp: modifiedSdp })
          : { type: desc.type, sdp: modifiedSdp };

        return origSetLocalDescription.call(this, newDesc).catch((err) => {
          console.warn('[WebRTC] Modified SDP rejected, falling back to native SDP:', err);
          return origSetLocalDescription.apply(this, arguments);
        });
      } catch (e) {
        console.warn('[WebRTC] SDP modification failed, using original description:', e);
      }
    }
    return origSetLocalDescription.apply(this, arguments);
  };
  console.log('[WebRTC] Hi-Fi Stereo Audio SDP interceptor active (256kbps 48kHz Opus with In-Band FEC)');
}
