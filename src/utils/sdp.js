// Studio Hi-Fi Audio SDP Munging for WebRTC
// Forces Opus to 48kHz Stereo 256kbps Full-Band Studio Music mode
// Eliminates voice compression, telephone speech filtering, and robotic distortion.

export function configureHighFidelityAudioSDP(sdp) {
  if (!sdp || typeof sdp !== 'string') return sdp;

  let modified = sdp;

  // 1. Remove voice comfort noise
  modified = modified.replace(/a=rtpmap:(\d+)\s+CN\/[^\r\n]+[\r\n]+/gi, '');

  // 2. Locate Opus codec payload type (standard is 111)
  const opusMatch = modified.match(/a=rtpmap:(\d+)\s+opus\/48000/i);
  if (opusMatch) {
    const pt = opusMatch[1];
    const fmtpRegex = new RegExp(`a=fmtp:${pt}\\s+([^\\r\\n]+)`, 'i');

    // Studio Quality Parameters:
    // - stereo=1: Full stereo channel decoding
    // - sprop-stereo=1: Signal stereo capabilities in SDP
    // - maxaveragebitrate=256000: Studio 256kbps bit-rate (vs default 32kbps speech)
    // - maxplaybackrate=48000: Full 48kHz frequency spectrum
    // - cbr=1: Constant bitrate for jitter-free packet spacing
    // - useinbandfec=0: Disable voice forward error correction for pristine musical transients
    const studioParams = 'stereo=1;sprop-stereo=1;maxaveragebitrate=256000;maxplaybackrate=48000;cbr=1;useinbandfec=0';

    if (fmtpRegex.test(modified)) {
      modified = modified.replace(fmtpRegex, (match, existing) => {
        const filtered = existing
          .split(';')
          .map(s => s.trim())
          .filter(s => !/^(stereo|sprop-stereo|maxaveragebitrate|maxplaybackrate|cbr|useinbandfec)=/i.test(s))
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
// Ensures all PeerJS and WebRTC calls universally transmit 256kbps Hi-Fi stereo music
if (typeof window !== 'undefined' && window.RTCPeerConnection) {
  const origSetLocalDescription = window.RTCPeerConnection.prototype.setLocalDescription;
  window.RTCPeerConnection.prototype.setLocalDescription = function (desc) {
    if (desc && desc.sdp) {
      desc.sdp = configureHighFidelityAudioSDP(desc.sdp);
    }
    return origSetLocalDescription.apply(this, arguments);
  };
  console.log('[WebRTC] Studio Hi-Fi Stereo Audio SDP interceptor active (256kbps 48kHz Opus)');
}
