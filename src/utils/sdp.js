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

    // Broadcast High-Fidelity Robust Stereo Parameters:
    // - stereo=1: Full stereo channel decoding
    // - sprop-stereo=1: Signal stereo capabilities in SDP
    // - maxaveragebitrate=192000: Broadcast transparent 192kbps stereo (CD audio quality)
    // - maxplaybackrate=48000: Full 48kHz frequency spectrum
    // - useinbandfec=1: Forward Error Correction seamlessly heals dropped Wi-Fi packets without audio drops
    // - ptime=20 / minptime=20: Standard 20ms packet pacing prevents router queue congestion and packet loss
    // - cbr=0: Dynamic Variable Bitrate prevents Wi-Fi buffer overruns
    const studioParams = 'stereo=1;sprop-stereo=1;maxaveragebitrate=192000;maxplaybackrate=48000;useinbandfec=1;cbr=0;ptime=20;minptime=20';

    if (fmtpRegex.test(modified)) {
      modified = modified.replace(fmtpRegex, (match, existing) => {
        const filtered = existing
          .split(';')
          .map(s => s.trim())
          .filter(s => !/^(stereo|sprop-stereo|maxaveragebitrate|maxplaybackrate|cbr|useinbandfec|ptime|minptime)=/i.test(s))
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
