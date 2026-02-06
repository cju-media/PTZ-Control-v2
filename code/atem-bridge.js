const express = require('express');
const { Atem } = require('atem-connection');
const ping = require('ping');
const os = require('os');
const net = require('net');
const app = express();

// Clear previous scan cache on startup
const fs = require('fs');
const path = require('path');
const cachePath = path.join(__dirname, 'discovered-atems.json');
try {
  fs.writeFileSync(cachePath, '{}');
  console.log('🧹 Cleared discovered-atems.json');
} catch (e) {
  console.warn('⚠️ Could not clear discovered-atems.json:', e.message);
}

const { execSync } = require('child_process');
const validSubnets = new Set();
const SKIP_LINK_LOCAL = true;

function getRefreshedSubnets() {
  const refreshedSubnets = new Set();

  const ifaces = os.networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    for (const config of iface) {
      if (config.family === 'IPv4' && !config.internal) {
        const subnet = config.address.split('.').slice(0, 3).join('.');
        refreshedSubnets.add(subnet);
      }
    }
  }

  try {
    const netstatOutput = execSync('netstat -rn', { encoding: 'utf8' });
    const lines = netstatOutput.split('\n');
    for (const line of lines) {
      const ipMatch = line.match(/(\d+\.\d+\.\d+)\.\d+/);
      if (ipMatch) {
        refreshedSubnets.add(ipMatch[1]);
      }
    }
  } catch (e) {
    console.warn('⚠️ Failed to refresh routing table:', e.message);
  }

  return refreshedSubnets;
}

// Detect subnets via interfaces
const interfaces = os.networkInterfaces();
for (const iface of Object.values(interfaces)) {
  for (const config of iface) {
    if (config.family === 'IPv4' && !config.internal) {
      const subnet = config.address.split('.').slice(0, 3).join('.');
      validSubnets.add(subnet);
    }
  }
}

// Detect subnets from routing table
try {
  const netstatOutput = execSync('netstat -rn', { encoding: 'utf8' });
  const lines = netstatOutput.split('\n');
  for (const line of lines) {
    const ipMatch = line.match(/(\d+\.\d+\.\d+)\.\d+/);
    if (ipMatch) {
      const subnet = ipMatch[1];
      validSubnets.add(subnet);
    }
  }
} catch (e) {
  console.warn('⚠️ Failed to parse routing table:', e.message);
}

console.log('🧭 Available subnets:', Array.from(validSubnets).join(', '));

app.use(express.json());

let atem = new Atem();
let connected = false;
let currentIP = null;
let queuedInput = null;
let queuedTransition = null;
let transitionWatcher = null;
let lastProgramInput = null;
let lastConnectionState = 'disconnected';
let maxInputCount = Infinity;
let clients = [];

const inputAliases = {
  3010: 'mp1',
  3020: 'mp2',
  6000: 'ssrc',
  0: 'black'
};

const modelNames = {
  10: 'ATEM Mini',
  12: 'ATEM Mini Pro',
  15: 'ATEM Mini Pro ISO',
  14: 'ATEM Mini Extreme',
  16: 'ATEM Mini Extreme ISO',
  9: 'ATEM Television Studio HD',
  4: 'ATEM 1 M/E 4K',
  8: 'ATEM 2 M/E 4K'
};

// SSE stream
app.get('/status', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clients.push(res);
  res.write(`data: ${JSON.stringify({ status: lastConnectionState, ip: currentIP })}\n\n`);

  req.on('close', () => {
    clients = clients.filter(c => c !== res);
  });
});

function broadcastStatus(status) {
  lastConnectionState = status;
  const data = `data: ${JSON.stringify({ status, ip: currentIP })}\n\n`;
  clients.forEach(res => res.write(data));
  console.log(`Status: ${status}`);
}

function broadcastProgramInput(input) {
  if (maxInputCount !== Infinity && input >= 5 && input <= 8) {
    console.log(`Suppressed program input ${input} (above max of ${maxInputCount})`);
    return;
  }

  const label = inputAliases[input] || input.toString();
  const data = `data: ${JSON.stringify({ status: 'programinput', input, label })}\n\n`;
  clients.forEach(res => res.write(data));
  console.log(`Program input changed: ${input} (${label})`);
  console.log('program ' + label);
}

// Network IP scanner + atem.connect validation
app.get('/atem-scan', async (req, res) => {
  console.log('atem-scanning 1');

  if (!validSubnets || validSubnets.size === 0) {
    return res.status(500).send('No valid subnets available');
  }
  const refreshedSubnets = getRefreshedSubnets();
  console.log('🔁 Refreshed subnets:', Array.from(refreshedSubnets).join(', '));
  const found = [];
  const seenFingerprints = new Set();

  for (const baseIP of refreshedSubnets) {
    if (baseIP.startsWith('127.') || baseIP.startsWith('224.') || baseIP.startsWith('255.') || (SKIP_LINK_LOCAL && baseIP.startsWith('169.254.'))) {
      console.log(`⏭️ Skipping reserved subnet ${baseIP}.x`);
      continue;
    }
    if (baseIP.startsWith('127.') || baseIP.startsWith('224.') || baseIP.startsWith('255.')) {
      console.log(`⏭️ Skipping reserved subnet ${baseIP}.x`);
      continue;
    }
    console.log(`🔍 Scanning ${baseIP}.1 to ${baseIP}.254 using atem.connect...`);

    const alive = [];
    const pingPromises = [];
    for (let i = 1; i <= 254; i++) {
      const ip = `${baseIP}.${i}`;
      pingPromises.push(
        ping.promise.probe(ip, { timeout: 1 }).then(result => {
          if (result.alive) alive.push(ip);
        })
      );
    }

    await Promise.all(pingPromises);
    console.log(`🔎 Alive devices on ${baseIP}.x: ${alive.length}`);

    const CONCURRENCY_LIMIT = 5;
    const queue = [...alive];
    const atemChecks = [];

    for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
      atemChecks.push(new Promise(async resolveOuter => {
        while (queue.length > 0) {
          const ip = queue.shift();
          await new Promise(resolve => {
            const tempAtem = new Atem();

            const timeout = setTimeout(() => {
              console.log(`⏳ Timeout connecting to ${ip}`);
              tempAtem.removeAllListeners();
              try {
                tempAtem.disconnect();
              } catch (_) {
                console.warn(`⚠️ Failed to disconnect ${ip}`);
              }
              resolve();
            }, 100);

            tempAtem.once('connected', () => {
              clearTimeout(timeout);
              console.log('↪ ATEM state.info:', tempAtem.state.info);
              const fingerprint = JSON.stringify(tempAtem.state.info);
              if (seenFingerprints.has(fingerprint)) {
                console.log(`🔁 Skipping duplicate ATEM at ${ip} (same info)`);
              } else {
                seenFingerprints.add(fingerprint);
                const modelId = tempAtem.state.info?.model;
                const model = modelNames[modelId] || `Unknown (${modelId})`;
                const name = tempAtem.state.info?.displayName || '';
                found.push({ ip, model, name });
              }
              tempAtem.disconnect();
              resolve();
            });

            tempAtem.once('error', () => {
              clearTimeout(timeout);
              tempAtem.disconnect();
              resolve();
            });

            tempAtem.connect(ip);
          });
        }
        resolveOuter();
      }));
    }

    await Promise.all(atemChecks);
  }

  console.log(`Scan complete. Valid ATEMs found: ${found.length}`);
  found.forEach(dev => {
    console.log(`✅ ${dev.name || 'ATEM'} — ${dev.model} — ${dev.ip}`);
  });

  const outputPath = path.join(__dirname, 'discovered-atems.json');
  const mergedJson = {
    ip: found.map(entry => entry.ip),
    model: found.map(entry => entry.model),
    name: found.map(entry => entry.name)
  };
  fs.writeFileSync(outputPath, JSON.stringify(mergedJson, null, 2));
  console.log(`📝 Saved scan results to ${outputPath}`);
  console.log('atem-scanning 0');

  res.json(found);
});

// Connect to ATEM
app.post('/connect', (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).send('Missing IP');

  if (atem) atem.disconnect();
  atem = new Atem();

  atem.on('connected', () => {

    connected = true;
    currentIP = ip;

    const modelId = atem.state.info?.model;
    const modelName = modelNames[modelId] || `Unknown (${modelId})`;
    console.log(`Model ID: ${modelId}`);
    console.log(`Connected to model: ${modelName}`);
    broadcastStatus(`model ${modelName}`);

    if ([10, 12, 14, 15, 16].includes(modelId)) {
      maxInputCount = 4;
      console.log('→ Detected Mini-style ATEM. Suppressing program inputs > 4.');
    } else {
      maxInputCount = Infinity;
    }

    const programInput = atem.state?.video?.mixEffects?.[0]?.programInput;
    if (programInput !== undefined) {
      broadcastProgramInput(programInput);
    }

    broadcastStatus('connected');
  });

  atem.on('stateChanged', () => {
    const programInput = atem.state?.video?.mixEffects?.[0]?.programInput;
    if (programInput !== undefined && programInput !== lastProgramInput) {
      lastProgramInput = programInput;
      broadcastProgramInput(programInput);
    }
  });

  atem.on('disconnected', () => {
    connected = false;
    broadcastStatus('disconnected');
    console.log('ATEM disconnected');
  });

  atem.on('error', (err) => {
    connected = false;
    broadcastStatus('error');
    console.log('ATEM error:', err.message);
  });

  atem.connect(ip);
  res.send(`Connecting to ATEM at ${ip}`);
});

// Program switch
app.post('/macro', (req, res) => {
  console.log('Macro request received:', req.body);
  const { index } = req.body;
  if (!connected) return res.status(500).send('ATEM not connected');
  if (typeof index !== 'number') return res.status(400).send('Invalid macro index');

  if (!atem.macro || typeof atem.macro.runMacro !== 'function') {
    console.error('⚠️ ATEM macro system not available');
    return res.status(500).send('Macro system unavailable on this ATEM');
  }

  console.log('Available macros:', atem.state?.macro?.macros?.length);

  try {

    atem.macro.runMacro(index);
    console.log(`▶️ Running macro ${index}`);

    res.send(`Macro ${index} triggered`);
  } catch (e) {
    console.error('Failed to run macro:', e.message);
    res.status(500).send('Macro execution failed');
  }
});

app.post('/program', (req, res) => {
  const { input, transition = 'auto' } = req.body;
  if (!connected) return res.status(500).send('ATEM not connected');

  if (maxInputCount !== Infinity && input > maxInputCount) {
    console.log(`Blocked program switch to input ${input} (above allowed max of ${maxInputCount})`);
    return res.status(400).send(`Input ${input} is not allowed on this ATEM model.`);
  }

  const me = atem.state.video.mixEffects[0];
  const inTransition = me.transitionPosition.inTransition;

  if (inTransition) {
    queuedInput = input;
    queuedTransition = transition;
    setupTransitionWatcher();
  } else {
    atem.changePreviewInput(input);
    setTimeout(() => {
      if (transition === 'cut') atem.cut();
      else atem.autoTransition();
    }, 100);
  }

  res.send(`Handled input ${input}, transition=${transition}${inTransition ? ' (queued)' : ''}`);
});

// Safe transition watcher
function setupTransitionWatcher() {
  if (transitionWatcher) return;

  transitionWatcher = setInterval(() => {
    const me = atem.state.video.mixEffects[0];
    const inTransition = me.transitionPosition.inTransition;

    if (!inTransition && queuedInput !== null) {
      const targetInput = queuedInput;
      const targetTransition = queuedTransition;

      queuedInput = null;
      queuedTransition = null;
      clearInterval(transitionWatcher);
      transitionWatcher = null;

      if (me.programInput === targetInput) return;

      setTimeout(() => {
        atem.changePreviewInput(targetInput);
        setTimeout(() => {
          if (targetTransition === 'cut') atem.cut();
          else atem.autoTransition();
        }, 100);
      }, 150);
    }
  }, 50);
}

app.listen(3001, () => {
  console.log('ATEM bridge listening on http://localhost:3001');
});

// PTZ scan on all local subnets using HTTP port 80
app.get('/ptz-scan', async (req, res) => {
  console.log('ptz-scanning 1');
  console.log('📡 Starting multi-subnet HTTP PTZ scan...');
  const refreshedSubnets = getRefreshedSubnets();
  console.log('🔁 Refreshed subnets:', Array.from(refreshedSubnets).join(', '));
  try {
    const { execSync } = require('child_process');
    const netstatOutput = execSync('netstat -rn', { encoding: 'utf8' });
    // console.log('🧾 netstat -rn output:\n' + netstatOutput);
  } catch (e) {
    console.warn('⚠️ Failed to run netstat:', e.message);
  }

  const { execSync } = require('child_process');
  const subnets = new Set();

  // Detect subnets via os.networkInterfaces()
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const config of iface) {
      if (config.family === 'IPv4' && !config.internal) {
        const subnet = config.address.split('.').slice(0, 3).join('.');
        subnets.add(subnet);
      }
    }
  }

  // Add subnets from routing table via netstat
  try {
    const output = execSync('netstat -rn', { encoding: 'utf8' });
    const lines = output.split('\n');
    for (const line of lines) {
      const ipMatch = line.match(/(\d+\.\d+\.\d+)\.\d+/);
      if (ipMatch) {
        const subnet = ipMatch[1];
        subnets.add(subnet);
      }
    }
  } catch (e) {
    console.warn('⚠️ Failed to read routing table:', e.message);
  }

  if (subnets.size === 0) return res.status(500).send('No valid subnets found');

  console.log('🧭 Scanning subnets:', Array.from(subnets).join(', '));

  const http = require('http');
  const found = [];

  for (const baseIP of refreshedSubnets) {
    if (baseIP.startsWith('127.') || baseIP.startsWith('224.') || baseIP.startsWith('255.') || (SKIP_LINK_LOCAL && baseIP.startsWith('169.254.'))) {
      console.log(`⏭️ Skipping reserved subnet ${baseIP}.x`);
      continue;
    }
    console.log(`🌐 Scanning ${baseIP}.1–254...`);
    const alive = [];
    const pingPromises = [];

    for (let i = 1; i <= 254; i++) {
      const ip = `${baseIP}.${i}`;
      pingPromises.push(
        ping.promise.probe(ip, { timeout: 1 }).then(result => {
          if (result.alive) alive.push(ip);
        })
      );
    }

    await Promise.all(pingPromises);
    console.log(`🔎 Alive on ${baseIP}.x: ${alive.length}`);

    const checks = alive.map(ip => {
      return new Promise(resolve => {
        const socket = new net.Socket();
        let connected = false;

        socket.setTimeout(1000);
        socket.on('connect', () => {
          connected = true;
          socket.destroy();
          console.log(`🎯 TCP PTZ confirmed at ${ip}`);
          found.push({ ip });
          resolve();
        });

        socket.on('timeout', () => {
          socket.destroy();
          resolve();
        });

        socket.on('error', () => {
          socket.destroy();
          resolve();
        });

        socket.connect(5678, ip);
      });
      const req = http.get({
        host: ip,
        port: 80,
        path: '/',
        timeout: 3000,
        headers: {
          'User-Agent': 'PTZ-Scanner/1.0'
        }
      }, (res2) => {
        console.log(`📡 ${ip} responded with status ${res2.statusCode}`);
        if (res2.statusCode === 401) {
          console.log(`🎯 Likely PTZ at ${ip}`);
          found.push({ ip });
        }
        res2.resume();
        resolve();
      });

      req.on('error', () => resolve());
      req.on('timeout', () => {
        req.abort();
        resolve();
      });
    });


    await Promise.all(checks);
  }

  const ptzText = found.map((dev, idx) => `${idx + 1}, ${dev.ip};`).join('');
  const ptzFilePath = path.join(__dirname, 'ptz-cameras.txt');
  fs.writeFileSync(ptzFilePath, ptzText);
  console.log('ptz-scanning 0');
  console.log(`📝 Saved PTZ list to ${ptzFilePath}`);
  console.log(`✅ Full PTZ scan complete. Found: ${found.length}`);
  res.json(found);
});
