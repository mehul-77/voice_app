const localtunnel = require('localtunnel');
const { spawn } = require('child_process');
const http = require('http');

const PORT = process.env.PORT || 3000;

// Start server child process
console.log('Starting local Stealth Voice Server on port', PORT, '...');
const serverProc = spawn('node', ['server.js'], { stdio: 'inherit' });

// Function to wait until local server is responding
function waitForServer(retries = 20, delay = 500) {
    return new Promise((resolve, reject) => {
        const check = (count) => {
            const req = http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
                if (res.statusCode === 200) return resolve();
                retry(count);
            });
            req.on('error', () => retry(count));
            req.end();
        };

        const retry = (count) => {
            if (count <= 0) return reject(new Error('Server failed to start in time.'));
            setTimeout(() => check(count - 1), delay);
        };

        check(retries);
    });
}

async function startTunnel() {
    try {
        await waitForServer();
        console.log('Server is healthy! Opening public HTTPS tunnel...');

        const tunnel = await localtunnel({ port: PORT });

        console.log('\n=============================================================');
        console.log('🚀 YOUR PUBLIC CALL APP IS LIVE WORLDWIDE!');
        console.log(`🔗 Public HTTPS URL: ${tunnel.url}`);
        console.log('=============================================================');
        console.log('👉 Open this URL on your iPhone, Android, and PC:');
        console.log(`   ${tunnel.url}`);
        console.log('\n📱 On iPhone (Safari): Tap Share -> "Add to Home Screen"');
        console.log('🤖 On Android (Chrome): Tap Menu -> "Install App"');
        console.log('💻 On Computer: Open in any modern browser');
        console.log('=============================================================\n');

        tunnel.on('close', () => {
            console.log('Tunnel closed.');
        });

        tunnel.on('error', (err) => {
            console.error('Tunnel error:', err);
        });

    } catch (err) {
        console.error('Failed to open tunnel:', err.message);
    }
}

startTunnel();

process.on('SIGINT', () => {
    serverProc.kill();
    process.exit();
});
