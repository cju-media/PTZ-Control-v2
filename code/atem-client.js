const maxApi = require('max-api');
const http = require('http');
const path = require('path');

const aliasMap = {
    ssrc: 6000,
    supersource: 6000,
    mp1: 3010,
    mediaplayer1: 3010,
    mp2: 3020,
    mediaplayer2: 3020
};

const BRIDGE_PORT = 3001;
const thisScriptPath = __filename;
const bridgePath = path.join(path.dirname(thisScriptPath), 'atem-bridge.js');
maxApi.outlet(['bridge-path', bridgePath]);

// Connect
maxApi.addHandler('connect', (ip) => {
    const data = JSON.stringify({ ip });

    const req = http.request({
        hostname: 'localhost',
        port: BRIDGE_PORT,
        path: '/connect',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    }, (res) => {
        res.on('data', chunk => maxApi.post(chunk.toString()));
    });

    req.on('error', err => maxApi.post('Connect error: ' + err.message));
    req.write(data);
    req.end();
});

// Program
maxApi.addHandler('program', (inputRaw, transition = 'auto') => {
    const key = inputRaw.toString().toLowerCase();
    const input = aliasMap[key] ?? parseInt(inputRaw, 10);

    if (isNaN(input)) {
        maxApi.post(`Unknown input: "${inputRaw}"`);
        return;
    }

    const data = JSON.stringify({ input, transition });

    const req = http.request({
        hostname: 'localhost',
        port: BRIDGE_PORT,
        path: '/program',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    }, (res) => {
        res.on('data', chunk => maxApi.post(chunk.toString()));
    });

    req.on('error', err => maxApi.post('Program error: ' + err.message));
    req.write(data);
    req.end();
});

// Discover ATEMs
maxApi.addHandler('discover', () => {
    const req = http.get({
        hostname: 'localhost',
        port: BRIDGE_PORT,
        path: '/discover',
        method: 'GET'
    }, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
            try {
                const devices = JSON.parse(raw);
                devices.forEach(device => {
                    maxApi.outlet(['discover', device.name, device.ip]);
                });
            } catch (e) {
                maxApi.post('Discover parse error: ' + e.message);
            }
        });
    });

    req.on('error', err => {
        maxApi.post('Discover error: ' + err.message);
    });

    req.end();
});

// Scan reachable IPs in subnet
maxApi.addHandler('atem-scan', () => {
    const options = {
        hostname: 'localhost',
        port: BRIDGE_PORT,
        path: '/atem-scan',
        method: 'GET',
        timeout: 15000 // 15 seconds to allow full scan to complete
    };

    const req = http.request(options, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
            try {
                const results = JSON.parse(raw);
                results.forEach(({ ip, name, model }) => {
                    maxApi.outlet(['found', name || 'ATEM', model, ip]);
                });
            } catch (e) {
                maxApi.post('Scan parse error: ' + e.message);
            }
        });
    });

    req.on('error', err => {
        maxApi.post('Scan error: ' + err.message);
    });

    req.end();
});


// Scan for VISCA PTZ cameras on port 5678
maxApi.addHandler('scan-ptz', () => {
    const options = {
        hostname: 'localhost',
        port: BRIDGE_PORT,
        path: '/ptz-scan',
        method: 'GET',
        timeout: 10000
    };

    const req = http.request(options, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
            try {
                const results = JSON.parse(raw);
                results.forEach(({ ip }) => {
                    maxApi.outlet(['ptz-found', ip]);
                });
            } catch (e) {
                maxApi.post('PTZ Scan parse error: ' + e.message);
            }
        });
    });

    req.on('error', err => {
        maxApi.post('PTZ Scan error: ' + err.message);
    });

    req.end();
});


// Status stream (SSE)
function startStatusListener() {
    const options = {
        hostname: 'localhost',
        port: BRIDGE_PORT,
        path: '/status',
        headers: { Accept: 'text/event-stream' }
    };

    const req = http.get(options, (res) => {
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
            if (chunk.startsWith('data:')) {
                try {
                    const json = JSON.parse(chunk.replace('data:', '').trim());

                    if (json.status === 'connected' || json.status === 'disconnected' || json.status === 'error') {
                        maxApi.outlet(['status', json.status, json.ip || '']);
                    }

                    else if (json.status === 'programinput') {
                        const label = json.label || json.input.toString();
                        maxApi.outlet(['program', label]);
                    }

                } catch (e) {
                    maxApi.post('Status parse error: ' + e.message);
                }
            }
        });
    });

    req.on('error', err => maxApi.post('Status listener error: ' + err.message));
}

startStatusListener();


// Trigger an ATEM macro by index
maxApi.addHandler('macro', (indexRaw) => {
    const index = parseInt(indexRaw, 10);
    //maxApi.post(`Macro command received. Parsed index: ${index}`);

    if (isNaN(index)) {
        maxApi.post(`Invalid macro index: ${indexRaw}`);
        return;
    }

    const data = JSON.stringify({ index });
    //maxApi.post(`Sending macro index ${index} to server`);

    const req = http.request({
        hostname: 'localhost',
        port: BRIDGE_PORT,
        path: '/macro',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    }, (res) => {
        //res.on('data', chunk => maxApi.post(chunk.toString()));
    });

    //req.on('error', err => maxApi.post('Macro error: ' + err.message));
    req.write(data);
    req.end();
});