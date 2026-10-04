// StealthVoice & Video Client Engine (v2.0 - Resilient WebRTC)
let ws = null;
let pc = null;
let localStream = null;
let audioContext = null;
let analyser = null;
let animFrameId = null;
let callStartTime = null;
let timerInterval = null;
let isMuted = false;
let isVideoMuted = false;
let isVideoCallActive = false;
let currentFacingMode = 'user';
let candidateQueue = [];

// Multi-provider STUN + OpenRelay TURN (Works on 4G/5G mobile carriers & Symmetric NATs)
const defaultIceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.services.mozilla.com:3478' },
    // Free public OpenRelay TURN servers for NAT traversal & firewall bypass
    {
        urls: [
            'turn:openrelay.metered.ca:80',
            'turn:openrelay.metered.ca:443',
            'turns:openrelay.metered.ca:443?transport=tcp'
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject'
    }
];

// DOM Elements
const roomInput = document.getElementById('roomInput');
const preCallActions = document.getElementById('preCallActions');
const inCallActions = document.getElementById('inCallActions');
const muteBtn = document.getElementById('muteBtn');
const videoToggleBtn = document.getElementById('videoToggleBtn');
const flipCamBtn = document.getElementById('flipCamBtn');
const speakerBtn = document.getElementById('speakerBtn');
const statusBadge = document.getElementById('statusBadge');
const statusDetail = document.getElementById('statusDetail');
const callTimer = document.getElementById('callTimer');
const micMeter = document.getElementById('micMeter');
const networkModeBadge = document.getElementById('networkModeBadge');
const videoContainer = document.getElementById('videoContainer');
const remoteVideo = document.getElementById('remoteVideo');
const localVideo = document.getElementById('localVideo');
const remoteAudio = document.getElementById('remoteAudio');
const settingsModal = document.getElementById('settingsModal');

// Settings inputs
const turnServerInput = document.getElementById('turnServerInput');
const turnUserInput = document.getElementById('turnUserInput');
const turnPassInput = document.getElementById('turnPassInput');
const forceRelayCheckbox = document.getElementById('forceRelayCheckbox');
const bitrateSelect = document.getElementById('bitrateSelect');
const videoQualitySelect = document.getElementById('videoQualitySelect');

function loadSettings() {
    turnServerInput.value = localStorage.getItem('sv_turn_server') || '';
    turnUserInput.value = localStorage.getItem('sv_turn_user') || '';
    turnPassInput.value = localStorage.getItem('sv_turn_pass') || '';
    forceRelayCheckbox.checked = localStorage.getItem('sv_force_relay') === 'true';
    bitrateSelect.value = localStorage.getItem('sv_bitrate') || '12000';
    videoQualitySelect.value = localStorage.getItem('sv_video_quality') || 'low';
    updateRelayModeBadge();
}

function saveSettings() {
    localStorage.setItem('sv_turn_server', turnServerInput.value.trim());
    localStorage.setItem('sv_turn_user', turnUserInput.value.trim());
    localStorage.setItem('sv_turn_pass', turnPassInput.value.trim());
    localStorage.setItem('sv_force_relay', forceRelayCheckbox.checked);
    localStorage.setItem('sv_bitrate', bitrateSelect.value);
    localStorage.setItem('sv_video_quality', videoQualitySelect.value);
    updateRelayModeBadge();
    closeSettings();
    showToast('Settings saved!');
}

function updateRelayModeBadge() {
    if (forceRelayCheckbox.checked) {
        networkModeBadge.innerText = '🛡️ Stealth Relay (Port 443 Only)';
        networkModeBadge.style.color = '#38bdf8';
    } else {
        networkModeBadge.innerText = '⚡ Hybrid P2P & Cloud Relay';
        networkModeBadge.style.color = '#a3e635';
    }
}

function openSettings() { settingsModal.style.display = 'flex'; }
function closeSettings() { settingsModal.style.display = 'none'; }

function getRtcConfig() {
    let iceServers = [...defaultIceServers];
    const customTurn = turnServerInput.value.trim();
    if (customTurn) {
        iceServers.unshift({
            urls: customTurn.startsWith('turn') ? customTurn : `turns:${customTurn}:443?transport=tcp`,
            username: turnUserInput.value.trim(),
            credential: turnPassInput.value.trim()
        });
    }

    const config = {
        iceServers,
        iceCandidatePoolSize: 10
    };

    if (forceRelayCheckbox.checked) {
        config.iceTransportPolicy = 'relay';
    }
    return config;
}

function playTone(freq, type, duration) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch (e) {}
}

function setStatus(badgeText, badgeColor, detailText) {
    statusBadge.innerText = badgeText;
    statusBadge.style.backgroundColor = badgeColor;
    statusDetail.innerText = detailText;
}

function startTimer() {
    if (timerInterval) return; // already running
    callStartTime = Date.now();
    callTimer.style.display = 'block';
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        callTimer.innerText = `${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    callStartTime = null;
    callTimer.style.display = 'none';
    callTimer.innerText = '00:00';
}

function setupAudioMeter(stream) {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        function checkVolume() {
            if (!analyser) return;
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;
            const pct = Math.min(100, Math.round((avg / 128) * 100));
            micMeter.style.width = pct + '%';
            animFrameId = requestAnimationFrame(checkVolume);
        }
        checkVolume();
    } catch (e) {}
}

// Safely tweak SDP for low bandwidth without breaking WebKit / Chrome parsers
function tuneSDP(desc) {
    try {
        const targetBitrate = parseInt(bitrateSelect.value, 10) || 12000;
        let sdp = desc.sdp;

        // Match Opus payload type dynamically from rtpmap
        const opusMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000/i);
        if (opusMatch && opusMatch[1]) {
            const pt = opusMatch[1];
            const fmtpRegex = new RegExp(`a=fmtp:${pt} (.*)`, 'i');
            if (fmtpRegex.test(sdp)) {
                sdp = sdp.replace(fmtpRegex, (match, params) => {
                    let cleaned = params.replace(/maxaveragebitrate=\d+;?/g, '')
                                        .replace(/useinbandfec=\d;?/g, '')
                                        .replace(/usedtx=\d;?/g, '');
                    return `a=fmtp:${pt} ${cleaned.trim()};maxaveragebitrate=${targetBitrate};useinbandfec=1;usedtx=1`;
                });
            } else {
                sdp = sdp.replace(
                    new RegExp(`(a=rtpmap:${pt} opus\/48000\/2\r?\n)`, 'i'),
                    `$1a=fmtp:${pt} maxaveragebitrate=${targetBitrate};useinbandfec=1;usedtx=1\r\n`
                );
            }
        }
        desc.sdp = sdp;
    } catch (e) {
        console.warn('SDP tuning skipped:', e);
    }
}

// Pre-unlock mobile browser audio/video playback within user click context
function unlockMobileAudio() {
    try {
        remoteAudio.play().catch(() => {});
        remoteVideo.play().catch(() => {});
    } catch (e) {}
}

// Start Call (Voice or Video)
async function startCall(enableVideo = false) {
    const room = roomInput.value.trim().toLowerCase();
    if (!room) {
        showToast('Please enter a room code.');
        return;
    }

    // Critical for iOS Safari and Android Chrome: unlock media playback during touch gesture
    unlockMobileAudio();

    isVideoCallActive = enableVideo;
    candidateQueue = [];

    setStatus('Requesting Access', '#f59e0b', 'Allow microphone and camera access...');

    const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 16000
    };

    let videoConstraints = false;
    if (enableVideo) {
        const quality = videoQualitySelect.value;
        const resMap = {
            low: { width: 360, height: 270, frameRate: 15 },
            medium: { width: 640, height: 480, frameRate: 24 },
            high: { width: 1280, height: 720, frameRate: 30 }
        };
        const selectedRes = resMap[quality] || resMap.low;

        videoConstraints = {
            facingMode: currentFacingMode,
            width: { ideal: selectedRes.width },
            height: { ideal: selectedRes.height },
            frameRate: { max: selectedRes.frameRate }
        };
    }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: videoConstraints
        });

        setupAudioMeter(localStream);

        if (enableVideo) {
            videoContainer.style.display = 'block';
            localVideo.srcObject = localStream;
            localVideo.play().catch(()=>{});
            flipCamBtn.style.display = 'inline-flex';
            videoToggleBtn.style.display = 'inline-flex';
        } else {
            videoContainer.style.display = 'none';
            flipCamBtn.style.display = 'none';
            videoToggleBtn.style.display = 'none';
        }
    } catch (err) {
        console.error('Media error:', err);
        setStatus('Permission Denied', '#ef4444', 'Microphone/Camera permission denied. Please allow access.');
        return;
    }

    preCallActions.style.display = 'none';
    inCallActions.style.display = 'grid';
    roomInput.disabled = true;

    setStatus('Connecting Relay', '#3b82f6', 'Connecting to global signaling relay...');
    playTone(440, 'sine', 0.2);

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
        setStatus('Waiting for Other Device', '#f59e0b', `Room "${room}" active. Waiting for other device to tap call...`);
        ws.send(JSON.stringify({ type: 'join', room }));
    };

    ws.onmessage = async (evt) => {
        try {
            const msg = JSON.parse(evt.data);

            if (msg.type === 'peer_joined') {
                setStatus('Initiating Connection', '#3b82f6', 'Other device detected! Negotiating encrypted line...');
                initPeer();
                const offer = await pc.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: isVideoCallActive
                });
                tuneSDP(offer);
                await pc.setLocalDescription(offer);
                ws.send(JSON.stringify({ type: 'signal', data: { sdp: pc.localDescription } }));
            } else if (msg.type === 'signal') {
                const signal = msg.data;

                // Handle SDP offer / answer
                if (signal.sdp) {
                    if (!pc) initPeer();

                    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

                    // DRAIN queued ICE candidates now that remote description is set!
                    while (candidateQueue.length > 0) {
                        const queuedCandidate = candidateQueue.shift();
                        try {
                            await pc.addIceCandidate(queuedCandidate);
                        } catch (err) {
                            console.warn('Queued ICE candidate error:', err);
                        }
                    }

                    if (signal.sdp.type === 'offer') {
                        const answer = await pc.createAnswer();
                        tuneSDP(answer);
                        await pc.setLocalDescription(answer);
                        ws.send(JSON.stringify({ type: 'signal', data: { sdp: pc.localDescription } }));
                    }
                }

                // Handle ICE candidate
                if (signal.candidate) {
                    const candidate = new RTCIceCandidate(signal.candidate);
                    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
                        try {
                            await pc.addIceCandidate(candidate);
                        } catch (e) {
                            console.warn('ICE add error:', e);
                        }
                    } else {
                        // Queue candidate until setRemoteDescription finishes!
                        candidateQueue.push(candidate);
                    }
                }
            } else if (msg.type === 'peer_left') {
                setStatus('Disconnected', '#ef4444', 'The other device hung up or left.');
                playTone(300, 'sawtooth', 0.3);
                endCall(false);
            }
        } catch (err) {
            console.error('Signaling processing error:', err);
        }
    };

    ws.onerror = () => setStatus('Network Error', '#ef4444', 'Could not reach server.');
    ws.onclose = () => {
        if (callStartTime) setStatus('Disconnected', '#64748b', 'Connection closed.');
    };
}

function initPeer() {
    if (pc) return;

    const config = getRtcConfig();
    pc = new RTCPeerConnection(config);

    // Attach all local audio/video tracks
    if (localStream) {
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }

    // Modern Unified-Plan track handler
    pc.ontrack = (event) => {
        console.log('[WebRTC] Received remote track:', event.track.kind);

        let stream = (event.streams && event.streams[0]) ? event.streams[0] : null;
        if (!stream) {
            if (!remoteAudio.srcObject) {
                remoteAudio.srcObject = new MediaStream();
            }
            stream = remoteAudio.srcObject;
            stream.addTrack(event.track);
        }

        remoteAudio.srcObject = stream;
        remoteAudio.play().catch((e) => console.log('Audio autoplay error:', e));

        if (event.track.kind === 'video' || stream.getVideoTracks().length > 0) {
            videoContainer.style.display = 'block';
            remoteVideo.srcObject = stream;
            remoteVideo.play().catch((e) => console.log('Video autoplay error:', e));
        }

        setStatus('Connected & Encrypted', '#10b981', 'Voice & video stream active.');
        startTimer();
    };

    // Forward ICE candidate to remote peer
    pc.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'signal',
                data: { candidate: event.candidate }
            }));
        }
    };

    pc.oniceconnectionstatechange = () => {
        if (!pc) return;
        const state = pc.iceConnectionState;
        console.log('[WebRTC] ICE Connection State:', state);

        if (state === 'connected' || state === 'completed') {
            setStatus('Connected & Encrypted', '#10b981', 'Direct / Relay voice stream active.');
        } else if (state === 'checking') {
            setStatus('Connecting Pathway', '#3b82f6', 'Testing direct P2P & relay pathways...');
        } else if (state === 'disconnected') {
            setStatus('Reconnecting...', '#f59e0b', 'Packet drop detected. Re-establishing audio...');
        } else if (state === 'failed') {
            setStatus('Connection Failed', '#ef4444', 'Could not establish pathway. Check internet signal.');
        }
    };
}

// Toggle Mic Mute
function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);

    if (isMuted) {
        muteBtn.innerText = '🔇 Unmute';
        muteBtn.style.backgroundColor = '#475569';
        showToast('Mic Muted');
    } else {
        muteBtn.innerText = '🎤 Mute';
        muteBtn.style.backgroundColor = '#1e293b';
        showToast('Mic Active');
    }
}

// Toggle Video On/Off
function toggleVideo() {
    if (!localStream) return;
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length === 0) return;

    isVideoMuted = !isVideoMuted;
    videoTracks.forEach(t => t.enabled = !isVideoMuted);

    if (isVideoMuted) {
        videoToggleBtn.innerText = '📷 Cam On';
        videoToggleBtn.style.backgroundColor = '#475569';
        showToast('Camera Turned Off');
    } else {
        videoToggleBtn.innerText = '📷 Cam Off';
        videoToggleBtn.style.backgroundColor = '#1e293b';
        showToast('Camera Turned On');
    }
}

// Flip Camera (Front / Back on Mobile)
async function flipCamera() {
    if (!localStream || !isVideoCallActive) return;
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode }
        });
        const newVideoTrack = newStream.getVideoTracks()[0];

        if (pc) {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) sender.replaceTrack(newVideoTrack);
        }

        localStream.getVideoTracks().forEach(t => t.stop());
        localStream.removeTrack(localStream.getVideoTracks()[0]);
        localStream.addTrack(newVideoTrack);
        localVideo.srcObject = localStream;
        localVideo.play().catch(()=>{});

        showToast(currentFacingMode === 'user' ? 'Front Camera' : 'Rear Camera');
    } catch (e) {
        console.warn('Could not flip camera:', e);
    }
}

function toggleSpeaker() {
    showToast('Audio playing through speaker');
}

function endCall(sendLeave = true) {
    if (sendLeave && ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'leave' })); } catch (e) {}
    }

    if (animFrameId) cancelAnimationFrame(animFrameId);
    micMeter.style.width = '0%';

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
    }

    if (pc) {
        pc.close();
        pc = null;
    }

    if (ws) {
        ws.close();
        ws = null;
    }

    candidateQueue = [];
    stopTimer();
    preCallActions.style.display = 'grid';
    inCallActions.style.display = 'none';
    videoContainer.style.display = 'none';
    roomInput.disabled = false;

    if (isMuted) toggleMute();
    if (isVideoMuted) toggleVideo();

    if (!statusDetail.innerText.includes('hung up') && !statusDetail.innerText.includes('left')) {
        setStatus('Ready', '#64748b', 'Choose Voice or Video call to start.');
    }
}

function showToast(text) {
    const toast = document.getElementById('toast');
    toast.innerText = text;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 2200);
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}

loadSettings();
