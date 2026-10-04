const express = require('express');
const http = require('http');
const { Server } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime(), onlineUsers: usersByNumber.size });
});

// Map of phoneNumber -> Set of ws sockets (in case same user has multiple tabs open)
const usersByNumber = new Map();
// Map of roomName -> Set of ws sockets (for instant link fallback)
const rooms = new Map();

function normalizeNumber(num) {
    if (!num) return '';
    return num.toString().replace(/[\s\-\(\)\.]/g, '').toLowerCase();
}

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.registeredNumber = null;
    ws.currentRoom = null;
    ws.peerSocket = null;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);

            switch (data.type) {
                // 1. User registers their own phone number / ID
                case 'register': {
                    const number = normalizeNumber(data.number);
                    if (!number) return;

                    // Remove previous registration if changed
                    if (ws.registeredNumber && usersByNumber.has(ws.registeredNumber)) {
                        usersByNumber.get(ws.registeredNumber).delete(ws);
                    }

                    ws.registeredNumber = number;
                    if (!usersByNumber.has(number)) {
                        usersByNumber.set(number, new Set());
                    }
                    usersByNumber.get(number).add(ws);

                    console.log(`[Register] User registered number: ${number}. Online devices for this number: ${usersByNumber.get(number).size}`);

                    ws.send(JSON.stringify({
                        type: 'registered',
                        number: number,
                        success: true
                    }));
                    break;
                }

                // 2. Caller initiates a call to targetNumber
                case 'call_user': {
                    const target = normalizeNumber(data.targetNumber);
                    const caller = ws.registeredNumber || normalizeNumber(data.callerNumber) || 'Unknown';
                    const callType = data.callType || 'video'; // 'video' or 'voice'

                    console.log(`[Call] ${caller} is calling ${target} (${callType})`);

                    if (usersByNumber.has(target) && usersByNumber.get(target).size > 0) {
                        const targetSockets = usersByNumber.get(target);
                        let sent = false;

                        targetSockets.forEach((targetWs) => {
                            if (targetWs.readyState === ws.OPEN) {
                                targetWs.peerSocket = ws;
                                ws.peerSocket = targetWs;

                                targetWs.send(JSON.stringify({
                                    type: 'incoming_call',
                                    caller: caller,
                                    callType: callType,
                                    sdp: data.sdp
                                }));
                                sent = true;
                            }
                        });

                        if (sent) {
                            ws.send(JSON.stringify({ type: 'call_ringing', target: target }));
                        }
                    } else {
                        // Target is not online right now
                        ws.send(JSON.stringify({
                            type: 'user_offline',
                            target: target,
                            message: `${target} is not online right now. Share your direct call link with them!`
                        }));
                    }
                    break;
                }

                // 3. Callee accepts the incoming call
                case 'accept_call': {
                    if (ws.peerSocket && ws.peerSocket.readyState === ws.OPEN) {
                        ws.peerSocket.send(JSON.stringify({
                            type: 'call_accepted',
                            sdp: data.sdp
                        }));
                    }
                    break;
                }

                // 4. Callee declines the incoming call
                case 'decline_call': {
                    if (ws.peerSocket && ws.peerSocket.readyState === ws.OPEN) {
                        ws.peerSocket.send(JSON.stringify({
                            type: 'call_declined',
                            reason: 'User declined the call.'
                        }));
                        ws.peerSocket.peerSocket = null;
                    }
                    ws.peerSocket = null;
                    break;
                }

                // 5. ICE Candidate routing
                case 'ice_candidate': {
                    if (ws.peerSocket && ws.peerSocket.readyState === ws.OPEN) {
                        ws.peerSocket.send(JSON.stringify({
                            type: 'ice_candidate',
                            candidate: data.candidate
                        }));
                    } else if (ws.currentRoom && rooms.has(ws.currentRoom)) {
                        // Room fallback routing
                        rooms.get(ws.currentRoom).forEach((client) => {
                            if (client !== ws && client.readyState === ws.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'ice_candidate',
                                    candidate: data.candidate
                                }));
                            }
                        });
                    }
                    break;
                }

                // 6. End Call
                case 'end_call': {
                    if (ws.peerSocket && ws.peerSocket.readyState === ws.OPEN) {
                        ws.peerSocket.send(JSON.stringify({ type: 'call_ended' }));
                        ws.peerSocket.peerSocket = null;
                    }
                    ws.peerSocket = null;
                    break;
                }

                // 7. Room fallback (allows joining via custom link e.g. /?room=123)
                case 'join_room': {
                    const room = normalizeNumber(data.room || 'default');
                    ws.currentRoom = room;
                    if (!rooms.has(room)) rooms.set(room, new Set());
                    rooms.get(room).add(ws);

                    const roomClients = rooms.get(room);
                    if (roomClients.size >= 2) {
                        roomClients.forEach((client) => {
                            if (client !== ws && client.readyState === ws.OPEN) {
                                ws.peerSocket = client;
                                client.peerSocket = ws;
                                client.send(JSON.stringify({ type: 'peer_joined', callType: data.callType || 'video' }));
                            }
                        });
                    }
                    break;
                }
            }
        } catch (err) {
            console.error('WebSocket message parsing error:', err.message);
        }
    });

    ws.on('close', () => {
        cleanupSocket(ws);
    });

    ws.on('error', (err) => {
        console.error('Socket error:', err.message);
        cleanupSocket(ws);
    });
});

function cleanupSocket(ws) {
    if (ws.peerSocket && ws.peerSocket.readyState === ws.OPEN) {
        ws.peerSocket.send(JSON.stringify({ type: 'call_ended' }));
        ws.peerSocket.peerSocket = null;
    }
    ws.peerSocket = null;

    if (ws.registeredNumber && usersByNumber.has(ws.registeredNumber)) {
        usersByNumber.get(ws.registeredNumber).delete(ws);
        if (usersByNumber.get(ws.registeredNumber).size === 0) {
            usersByNumber.delete(ws.registeredNumber);
        }
    }

    if (ws.currentRoom && rooms.has(ws.currentRoom)) {
        rooms.get(ws.currentRoom).delete(ws);
        if (rooms.get(ws.currentRoom).size === 0) {
            rooms.delete(ws.currentRoom);
        }
    }
}

// Keep-alive heartbeat every 15 seconds to prevent mobile browsers from sleeping
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 15000);

wss.on('close', () => clearInterval(heartbeatInterval));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(` FaceTime-Style Voice/Video Server on ${PORT}`);
    console.log(`=========================================`);
});
