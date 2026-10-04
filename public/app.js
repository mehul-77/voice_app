// StealthVoice & Video Client Engine
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
let currentFacingMode = 'user'; // 'user' (front) or 'environment' (back)

const defaultIceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
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
        networkModeBadge.innerText = '🛡️ Stealth Mode (TCP 443 Relay)';
        networkModeBadge.style.color = '#38bdf8';
    } else {
        networkModeBadge.innerText = '⚡ Hybrid P2P / Direct';
        networkModeBadge.style.color = '#a3e635';
    }
}

function openSettings() { settingsModal.style.display = 'flex'; }
function closeSettings() { settingsModal.style.display = 'none'; }

function getRtcConfig() {
    let iceServers = [...defaultIceServers];
    const customTurn = turnServerInput.value.trim();
    if (customTurn) {
        iceServers.push({
            urls: customTurn.startsWith('turn') ? customTurn : `turns:${customTurn}:443?transport=tcp`,
            username: turnUserInput.value.trim(),
            credential: turnPassInput.value.trim()
        });
    }

    const config = { iceServers };
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

function tuneSDP(desc) {
    const targetBitrate = parseInt(bitrateSelect.value, 10) || 12000;
    desc.sdp = desc.sdp.replace(
        /a=fmtp:111 ((?:(?!maxaveragebitrate).)*)\r\n/g,
        `a=fmtp:111 $1;maxaveragebitrate=${targetBitrate};useinbandfec=1;usedtx=1\r\n`
    );
}

// Start Call (voice or video)
async function startCall(enableVideo = false) {
    const room = roomInput.value.trim().toLowerCase();
    if (!room) {
        showToast('Please enter a room code.');
        return;
    }

    isVideoCallActive = enableVideo;
    setStatus('Requesting Permissions', '#f59e0b', 'Allow microphone and camera access...');

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
            flipCamBtn.style.display = 'inline-flex';
            videoToggleBtn.style.display = 'inline-flex';
        } else {
            videoContainer.style.display = 'none';
            flipCamBtn.style.display = 'none';
            videoToggleBtn.style.display = 'none';
        }
    } catch (err) {
        console.error('Media error:', err);
        setStatus('Permission Denied', '#ef4444', 'Microphone/Camera permission denied or camera busy.');
        return;
    }

    preCallActions.style.display = 'none';
    inCallActions.style.display = 'grid';
    roomInput.disabled = true;

    setStatus('Connecting Relay', '#3b82f6', 'Connecting to signaling network...');
    playTone(440, 'sine', 0.2);

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
        setStatus('Waiting for Peer', '#f59e0b', `Room "${room}" active. Waiting for other party...`);
        ws.send(JSON.stringify({ type: 'join', room }));
    };

    ws.onmessage = async (evt) => {
        try {
            const msg = JSON.parse(evt.data);

            if (msg.type === 'peer_joined') {
                setStatus('Initiating Line', '#3b82f6', 'Peer joined! Negotiating encrypted stream...');
                initPeer();
                const offer = await pc.createOffer();
                tuneSDP(offer);
                await pc.setLocalDescription(offer);
                ws.send(JSON.stringify({ type: 'signal', data: { sdp: pc.localDescription } }));
            } else if (msg.type === 'signal') {
                const signal = msg.data;
                if (signal.sdp) {
                    if (!pc) initPeer();
                    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

                    if (signal.sdp.type === 'offer') {
                        const answer = await pc.createAnswer();
                        tuneSDP(answer);
                        await pc.setLocalDescription(answer);
                        ws.send(JSON.stringify({ type: 'signal', data: { sdp: pc.localDescription } }));
                    }
                } else if (signal.candidate && pc) {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
                    } catch (e) {}
                }
            } else if (msg.type === 'peer_left') {
                setStatus('Call Ended', '#ef4444', 'The other person disconnected.');
                playTone(300, 'sawtooth', 0.3);
                endCall(false);
            }
        } catch (err) {
            console.error('Signaling error:', err);
        }
    };

    ws.onerror = () => setStatus('Network Error', '#ef4444', 'Could not reach server.');
    ws.onclose = () => {
        if (callStartTime) setStatus('Disconnected', '#64748b', 'Connection closed.');
    };
}

function initPeer() {
    const config = getRtcConfig();
    pc = new RTCPeerConnection(config);

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
            const stream = event.streams[0];
            remoteAudio.srcObject = stream;

            const hasVideo = stream.getVideoTracks().length > 0;
            if (hasVideo) {
                videoContainer.style.display = 'block';
                remoteVideo.srcObject = stream;
            }

            setStatus('In Call (Encrypted)', '#10b981', 'Encrypted audio/video active.');
            startTimer();
        }
    };

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
        if (state === 'connected' || state === 'completed') {
            setStatus('In Call (Encrypted)', '#10b981', 'Encrypted connection active.');
        } else if (state === 'disconnected') {
            setStatus('Reconnecting', '#f59e0b', 'Temporary packet drop. Reconnecting...');
        } else if (state === 'failed') {
            setStatus('Blocked by Firewall', '#ef4444', 'Enable "Force Stealth Relay" in settings.');
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

        // Replace track on RTCPeerConnection sender
        if (pc) {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) sender.replaceTrack(newVideoTrack);
        }

        // Stop old video track
        localStream.getVideoTracks().forEach(t => t.stop());
        localStream.removeTrack(localStream.getVideoTracks()[0]);
        localStream.addTrack(newVideoTrack);
        localVideo.srcObject = localStream;

        showToast(currentFacingMode === 'user' ? 'Front Camera' : 'Rear Camera');
    } catch (e) {
        console.warn('Could not flip camera:', e);
    }
}

function toggleSpeaker() {
    showToast('Audio routed through default output');
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

    stopTimer();
    preCallActions.style.display = 'grid';
    inCallActions.style.display = 'none';
    videoContainer.style.display = 'none';
    roomInput.disabled = false;

    if (isMuted) toggleMute();
    if (isVideoMuted) toggleVideo();

    if (!statusDetail.innerText.includes('disconnected')) {
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
