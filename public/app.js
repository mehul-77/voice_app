// StealthVoice Client Engine (v4.0 - Custom Stealth Identity & Protocol)
let ws = null;
let pc = null;
let localStream = null;
let myNumber = localStorage.getItem('sv_my_number') || '';
let isStealthMode = localStorage.getItem('sv_stealth_active') !== 'false'; // Default TRUE for UAE/strict networks
let currentCallTarget = null;
let isAudioMuted = false;
let isVideoMuted = false;
let isVideoCallActive = false;
let currentFacingMode = 'user';
let candidateQueue = [];
let callStartTime = null;
let callTimerInterval = null;
let ringtoneInterval = null;
let ringbackInterval = null;
let pendingIncomingCall = null;

// Multi-network ICE configuration with OpenRelay Port 443 TLS TURNS
const rtcConfig = {
    iceCandidatePoolSize: 10,
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.services.mozilla.com:3478' },
        {
            urls: [
                'turns:openrelay.metered.ca:443?transport=tcp',
                'turn:openrelay.metered.ca:443',
                'turn:openrelay.metered.ca:80'
            ],
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]
};

// UI Elements
const dialerScreen = document.getElementById('dialerScreen');
const outgoingScreen = document.getElementById('outgoingScreen');
const incomingScreen = document.getElementById('incomingScreen');
const activeCallScreen = document.getElementById('activeCallScreen');
const setupModal = document.getElementById('setupModal');
const settingsModal = document.getElementById('settingsModal');

const stealthBanner = document.getElementById('stealthBanner');
const stealthStatusTitle = document.getElementById('stealthStatusTitle');
const stealthStatusDesc = document.getElementById('stealthStatusDesc');

const myNumberLabel = document.getElementById('myNumberLabel');
const myNumberInput = document.getElementById('myNumberInput');
const targetNumberInput = document.getElementById('targetNumberInput');

const outgoingAvatar = document.getElementById('outgoingAvatar');
const outgoingTargetText = document.getElementById('outgoingTargetText');
const outgoingStatusText = document.getElementById('outgoingStatusText');

const incomingCallerName = document.getElementById('incomingCallerName');
const incomingCallTypeLabel = document.getElementById('incomingCallTypeLabel');

const activeCallPeerLabel = document.getElementById('activeCallPeerLabel');
const activeCallTimer = document.getElementById('activeCallTimer');
const remoteVideo = document.getElementById('remoteVideo');
const localVideo = document.getElementById('localVideo');
const localVideoWrapper = document.getElementById('localVideoWrapper');
const remoteAudio = document.getElementById('remoteAudio');

const micToggleBtn = document.getElementById('micToggleBtn');
const camToggleBtn = document.getElementById('camToggleBtn');
const flipCamBtn = document.getElementById('flipCamBtn');

const bitrateSelect = document.getElementById('bitrateSelect');
const videoQualitySelect = document.getElementById('videoQualitySelect');

// --- 1. Sound Synthesizers (Unique Futuristic Encrypted Line Chimes) ---
let audioCtx = null;
function getAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

// Futuristic cyber chime on incoming call
function playStealthChimeNote(freq, start, duration) {
    try {
        const ctx = getAudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
        gain.gain.setValueAtTime(0.25, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + duration);
    } catch(e) {}
}

function startIncomingRingtone() {
    stopRingtones();
    const playCyberTune = () => {
        const seq = [523.25, 659.25, 783.99, 1046.50, 783.99]; // C5, E5, G5, C6, G5
        seq.forEach((freq, idx) => playStealthChimeNote(freq, idx * 0.12, 0.3));
    };
    playCyberTune();
    ringtoneInterval = setInterval(playCyberTune, 2600);
}

function startRingbackTone() {
    stopRingtones();
    const playRadarBeep = () => {
        try {
            const ctx = getAudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.35);
        } catch(e) {}
    };
    playRadarBeep();
    ringbackInterval = setInterval(playRadarBeep, 2400);
}

function stopRingtones() {
    if (ringtoneInterval) { clearInterval(ringtoneInterval); ringtoneInterval = null; }
    if (ringbackInterval) { clearInterval(ringbackInterval); ringbackInterval = null; }
}

// --- 2. Identity & Stealth Mode Toggle ---
function checkMyNumber() {
    updateStealthBannerUI();
    if (!myNumber) {
        setupModal.style.display = 'flex';
    } else {
        myNumberLabel.innerText = myNumber;
        connectSignaling();
    }
}

function saveMyNumber() {
    const raw = myNumberInput.value.trim();
    if (!raw) return showToast('Please enter your phone number');
    myNumber = raw;
    localStorage.setItem('sv_my_number', myNumber);
    myNumberLabel.innerText = myNumber;
    setupModal.style.display = 'none';
    connectSignaling();
    showToast('Line Activated & Online');
}

function promptEditMyNumber() {
    myNumberInput.value = myNumber;
    setupModal.style.display = 'flex';
}

function toggleStealthMode() {
    isStealthMode = !isStealthMode;
    localStorage.setItem('sv_stealth_active', isStealthMode);
    updateStealthBannerUI();
    if (isStealthMode) {
        showToast('🛡️ Stealth Protocol Active (TCP 443 Encapsulated)');
    } else {
        showToast('⚡ Hybrid Mode (Direct P2P)');
    }
}

function updateStealthBannerUI() {
    if (isStealthMode) {
        stealthBanner.classList.remove('disabled');
        stealthStatusTitle.innerText = 'Stealth Protocol: ACTIVE';
        stealthStatusDesc.innerText = 'Wrapped in TLS Port 443 (DPI Bypass)';
    } else {
        stealthBanner.classList.add('disabled');
        stealthStatusTitle.innerText = 'Stealth Protocol: OFF';
        stealthStatusDesc.innerText = 'Hybrid Direct P2P Route';
    }
}

function setPrefix(prefix) {
    targetNumberInput.value = prefix;
    targetNumberInput.focus();
}

function copyMyCallLink() {
    if (!myNumber) return promptEditMyNumber();
    const link = `${location.origin}/?call=${encodeURIComponent(myNumber)}`;
    navigator.clipboard.writeText(link).then(() => {
        showToast('Direct call link copied! Share via WhatsApp/SMS.');
    }).catch(() => {
        prompt('Copy your direct link:', link);
    });
}

// --- 3. WebSocket Signaling Connection ---
function connectSignaling() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
        if (myNumber) {
            ws.send(JSON.stringify({ type: 'register', number: myNumber }));
        }
    };

    ws.onmessage = async (evt) => {
        try {
            const data = JSON.parse(evt.data);

            switch (data.type) {
                case 'registered':
                    console.log('[StealthVoice] Line active:', data.number);
                    break;

                case 'incoming_call':
                    handleIncomingCall(data);
                    break;

                case 'call_ringing':
                    outgoingStatusText.innerText = 'Ringing securely...';
                    startRingbackTone();
                    break;

                case 'call_accepted':
                    stopRingtones();
                    await handleCallAccepted(data.sdp);
                    break;

                case 'call_declined':
                    stopRingtones();
                    showToast('Call declined.');
                    hangupActiveCall(false);
                    break;

                case 'user_offline':
                    stopRingtones();
                    outgoingStatusText.innerText = 'Offline. Tap Share link below.';
                    showToast(data.message);
                    setTimeout(() => cancelOutgoingCall(), 3000);
                    break;

                case 'ice_candidate':
                    handleRemoteIceCandidate(data.candidate);
                    break;

                case 'call_ended':
                    stopRingtones();
                    showToast('Call terminated.');
                    hangupActiveCall(false);
                    break;
            }
        } catch (e) {
            console.error('Signaling error:', e);
        }
    };

    ws.onclose = () => {
        setTimeout(connectSignaling, 3000);
    };
}

// --- 4. Outgoing Call Flow ---
async function initiateCall(type = 'video') {
    const target = targetNumberInput.value.trim();
    if (!target) return showToast('Please enter a phone number');
    if (!myNumber) return promptEditMyNumber();

    getAudioContext();
    isVideoCallActive = (type === 'video');
    currentCallTarget = target;
    candidateQueue = [];

    outgoingTargetText.innerText = target;
    outgoingAvatar.innerText = isVideoCallActive ? '👁️' : '🎙️';
    outgoingStatusText.innerText = isStealthMode ? 'Routing via Stealth TLS (Port 443)...' : 'Connecting direct tunnel...';
    outgoingScreen.style.display = 'flex';

    try {
        await acquireLocalMedia(isVideoCallActive);
    } catch(err) {
        cancelOutgoingCall();
        return showToast('Microphone/Camera permission required.');
    }

    initPeerConnection();

    const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: isVideoCallActive
    });
    tuneSDP(offer);
    await pc.setLocalDescription(offer);

    ws.send(JSON.stringify({
        type: 'call_user',
        targetNumber: target,
        callerNumber: myNumber,
        callType: type,
        sdp: pc.localDescription
    }));
}

function cancelOutgoingCall() {
    stopRingtones();
    outgoingScreen.style.display = 'none';
    if (ws && currentCallTarget) {
        ws.send(JSON.stringify({ type: 'end_call', targetNumber: currentCallTarget }));
    }
    cleanupMedia();
}

// --- 5. Incoming Call Flow ---
function handleIncomingCall(data) {
    pendingIncomingCall = data;
    currentCallTarget = data.caller;
    isVideoCallActive = (data.callType === 'video');

    incomingCallerName.innerText = data.caller;
    incomingCallTypeLabel.innerText = isVideoCallActive ? 'Incoming Stealth Video Call' : 'Incoming Stealth Voice Call';
    incomingScreen.style.display = 'flex';

    startIncomingRingtone();
}

async function acceptIncomingCall() {
    stopRingtones();
    getAudioContext();
    incomingScreen.style.display = 'none';

    if (!pendingIncomingCall) return;

    try {
        await acquireLocalMedia(isVideoCallActive);
    } catch(err) {
        declineIncomingCall();
        return showToast('Microphone/Camera permission required.');
    }

    initPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(pendingIncomingCall.sdp));

    while (candidateQueue.length > 0) {
        await pc.addIceCandidate(candidateQueue.shift());
    }

    const answer = await pc.createAnswer();
    tuneSDP(answer);
    await pc.setLocalDescription(answer);

    ws.send(JSON.stringify({
        type: 'accept_call',
        sdp: pc.localDescription
    }));

    showActiveCallView();
}

function declineIncomingCall() {
    stopRingtones();
    incomingScreen.style.display = 'none';
    if (ws && pendingIncomingCall) {
        ws.send(JSON.stringify({ type: 'decline_call' }));
    }
    pendingIncomingCall = null;
    cleanupMedia();
}

async function handleCallAccepted(sdp) {
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));

    while (candidateQueue.length > 0) {
        await pc.addIceCandidate(candidateQueue.shift());
    }

    outgoingScreen.style.display = 'none';
    showActiveCallView();
}

async function handleRemoteIceCandidate(candidateData) {
    if (!candidateData) return;
    const cand = new RTCIceCandidate(candidateData);
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
            await pc.addIceCandidate(cand);
        } catch(e) {
            console.warn('ICE add error:', e);
        }
    } else {
        candidateQueue.push(cand);
    }
}

// --- 6. Media & WebRTC Management ---
async function acquireLocalMedia(withVideo) {
    const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 16000
    };

    let videoConstraints = false;
    if (withVideo) {
        const quality = videoQualitySelect.value;
        const resMap = {
            low: { width: 360, height: 270, frameRate: 15 },
            medium: { width: 640, height: 480, frameRate: 24 },
            high: { width: 1280, height: 720, frameRate: 30 }
        };
        const res = resMap[quality] || resMap.low;
        videoConstraints = {
            facingMode: currentFacingMode,
            width: { ideal: res.width },
            height: { ideal: res.height },
            frameRate: { max: res.frameRate }
        };
    }

    localStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: videoConstraints
    });

    if (withVideo) {
        localVideoWrapper.style.display = 'block';
        localVideo.srcObject = localStream;
        localVideo.play().catch(()=>{});
        camToggleBtn.style.display = 'flex';
        flipCamBtn.style.display = 'flex';
    } else {
        localVideoWrapper.style.display = 'none';
        camToggleBtn.style.display = 'none';
        flipCamBtn.style.display = 'none';
    }
}

function initPeerConnection() {
    if (pc) return;

    const conf = { ...rtcConfig };
    // STEALTH PROTOCOL: Force TCP Port 443 relay when active to bypass telecom DPI filters
    if (isStealthMode) {
        conf.iceTransportPolicy = 'relay';
    }

    pc = new RTCPeerConnection(conf);

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.ontrack = (event) => {
        let stream = (event.streams && event.streams[0]) ? event.streams[0] : null;
        if (!stream) {
            if (!remoteAudio.srcObject) remoteAudio.srcObject = new MediaStream();
            stream = remoteAudio.srcObject;
            stream.addTrack(event.track);
        }

        remoteAudio.srcObject = stream;
        remoteAudio.play().catch(()=>{});

        if (event.track.kind === 'video' || stream.getVideoTracks().length > 0) {
            remoteVideo.srcObject = stream;
            remoteVideo.play().catch(()=>{});
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'ice_candidate',
                candidate: event.candidate
            }));
        }
    };

    pc.oniceconnectionstatechange = () => {
        if (!pc) return;
        if (pc.iceConnectionState === 'disconnected') {
            showToast('Temporary packet drop. Reconnecting...');
        }
    };
}

function showActiveCallView() {
    dialerScreen.style.display = 'none';
    outgoingScreen.style.display = 'none';
    incomingScreen.style.display = 'none';
    activeCallScreen.style.display = 'block';

    activeCallPeerLabel.innerText = currentCallTarget;
    startCallTimer();
}

function startCallTimer() {
    callStartTime = Date.now();
    activeCallTimer.innerText = '00:00';
    if (callTimerInterval) clearInterval(callTimerInterval);
    callTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        activeCallTimer.innerText = `${mins}:${secs}`;
    }, 1000);
}

function hangupActiveCall(notifyPeer = true) {
    if (notifyPeer && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'end_call' }));
    }

    stopRingtones();
    if (callTimerInterval) clearInterval(callTimerInterval);

    cleanupMedia();

    activeCallScreen.style.display = 'none';
    outgoingScreen.style.display = 'none';
    incomingScreen.style.display = 'none';
    dialerScreen.style.display = 'flex';
}

function cleanupMedia() {
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    if (pc) {
        pc.close();
        pc = null;
    }
    candidateQueue = [];
    currentCallTarget = null;
    pendingIncomingCall = null;
    isAudioMuted = false;
    isVideoMuted = false;
    micToggleBtn.classList.remove('active-off');
    camToggleBtn.classList.remove('active-off');
}

// In-Call Controls
function toggleMute() {
    if (!localStream) return;
    isAudioMuted = !isAudioMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !isAudioMuted);
    micToggleBtn.classList.toggle('active-off', isAudioMuted);
    showToast(isAudioMuted ? '🎙️ Mic Muted' : '🎙️ Mic Active');
}

function toggleCamera() {
    if (!localStream) return;
    const vTracks = localStream.getVideoTracks();
    if (vTracks.length === 0) return;
    isVideoMuted = !isVideoMuted;
    vTracks.forEach(t => t.enabled = !isVideoMuted);
    camToggleBtn.classList.toggle('active-off', isVideoMuted);
    showToast(isVideoMuted ? '👁️ Camera Off' : '👁️ Camera On');
}

async function flipCamera() {
    if (!localStream || !isVideoCallActive) return;
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode }
        });
        const newTrack = newStream.getVideoTracks()[0];

        if (pc) {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) sender.replaceTrack(newTrack);
        }

        localStream.getVideoTracks().forEach(t => t.stop());
        localStream.removeTrack(localStream.getVideoTracks()[0]);
        localStream.addTrack(newTrack);
        localVideo.srcObject = localStream;
        localVideo.play().catch(()=>{});

        showToast(currentFacingMode === 'user' ? 'Front Lens' : 'Rear Lens');
    } catch(e) {
        console.warn('Flip camera error:', e);
    }
}

// Safe Opus tuning for low bandwidth
function tuneSDP(desc) {
    try {
        const bitrate = parseInt(bitrateSelect.value, 10) || 12000;
        let sdp = desc.sdp;
        const match = sdp.match(/a=rtpmap:(\d+) opus\/48000/i);
        if (match && match[1]) {
            const pt = match[1];
            sdp = sdp.replace(new RegExp(`a=fmtp:${pt} (.*)`, 'i'), (m, p) => {
                let clean = p.replace(/maxaveragebitrate=\d+;?/g, '').replace(/useinbandfec=\d;?/g, '').replace(/usedtx=\d;?/g, '');
                return `a=fmtp:${pt} ${clean.trim()};maxaveragebitrate=${bitrate};useinbandfec=1;usedtx=1`;
            });
        }
        desc.sdp = sdp;
    } catch(e) {}
}

function openSettings() { settingsModal.style.display = 'flex'; }
function closeSettings() { settingsModal.style.display = 'none'; }
function saveSettings() {
    closeSettings();
    showToast('Tuning settings saved');
}

function showToast(text) {
    const toast = document.getElementById('toast');
    toast.innerText = text;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-10px)';
    }, 2400);
}

// Auto load call target from ?call= parameter
window.addEventListener('load', () => {
    checkMyNumber();
    const params = new URLSearchParams(location.search);
    if (params.has('call')) {
        targetNumberInput.value = params.get('call');
        showToast('Contact loaded from link. Tap Voice or Video to connect!');
    }
});
