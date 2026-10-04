const express = require('express');
const http = require('http');
const { Server } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint for cloud platforms (Render, Railway, etc.)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

// Map of roomId -> Set of ws clients
const rooms = new Map();

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.roomId = null;
    ws.userId = Math.random().toString(36).substring(2, 9);

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);

            switch (data.type) {
                case 'join': {
                    const room = (data.room || 'default').trim().toLowerCase();
                    ws.roomId = room;

                    if (!rooms.has(room)) {
                        rooms.set(room, new Set());
                    }

                    const roomClients = rooms.get(room);
                    roomClients.add(ws);

                    console.log(`[Room: ${room}] User ${ws.userId} joined. Total peers: ${roomClients.size}`);

                    // Send confirmation to the joining peer
                    ws.send(JSON.stringify({
                        type: 'joined',
                        room: room,
                        userId: ws.userId,
                        peerCount: roomClients.size
                    }));

                    // If 2 or more clients are in the room, notify that connection can begin
                    if (roomClients.size >= 2) {
                        roomClients.forEach((client) => {
                            if (client !== ws && client.readyState === ws.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'peer_joined',
                                    userId: ws.userId
                                }));
                            }
                        });
                    }
                    break;
                }

                case 'signal': {
                    // Relay SDP offer/answer or ICE candidate to other peer(s) in the room
                    if (ws.roomId && rooms.has(ws.roomId)) {
                        const roomClients = rooms.get(ws.roomId);
                        roomClients.forEach((client) => {
                            if (client !== ws && client.readyState === ws.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'signal',
                                    sender: ws.userId,
                                    data: data.data
                                }));
                            }
                        });
                    }
                    break;
                }

                case 'leave': {
                    leaveCurrentRoom(ws);
                    break;
                }
            }
        } catch (err) {
            console.error('Error handling message:', err.message);
        }
    });

    ws.on('close', () => {
        leaveCurrentRoom(ws);
    });

    ws.on('error', (err) => {
        console.error(`WebSocket error for ${ws.userId}:`, err.message);
    });
});

function leaveCurrentRoom(ws) {
    if (ws.roomId && rooms.has(ws.roomId)) {
        const room = ws.roomId;
        const roomClients = rooms.get(room);
        roomClients.delete(ws);

        console.log(`[Room: ${room}] User ${ws.userId} left. Remaining peers: ${roomClients.size}`);

        // Notify remaining peers that the user disconnected
        roomClients.forEach((client) => {
            if (client.readyState === ws.OPEN) {
                client.send(JSON.stringify({
                    type: 'peer_left',
                    userId: ws.userId
                }));
            }
        });

        if (roomClients.size === 0) {
            rooms.delete(room);
            console.log(`[Room: ${room}] Room cleared.`);
        }

        ws.roomId = null;
    }
}

// Keep-alive heartbeat every 15 seconds to prevent mobile browsers (Safari/Chrome) from sleeping
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log(`[Heartbeat] Terminating inactive socket: ${ws.userId}`);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 15000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(` Stealth Voice Server active on port ${PORT}`);
    console.log(` Local access: http://localhost:${PORT}`);
    console.log(`=========================================`);
});
