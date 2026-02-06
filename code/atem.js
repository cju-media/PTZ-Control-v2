const Max = require('max-api');

const { Atem } = require('atem-connection');

const myAtem = new Atem();

console.log('🚀 Starting ATEM connection...');

myAtem.on('connected', async () => {
    console.log('✅ Connected to ATEM');

    // Change to input 3 on ME 0 (default)
    try {
        await myAtem.changeProgramInput(3);
        console.log('🎬 Switched program input to 3');
    } catch (err) {
        console.error('❌ Failed to change program input:', err);
    }
});

// Log current input when state updates
myAtem.on('stateChanged', (state) => {
    const programInput = state?.video?.mixEffects?.[0]?.programInput;
    if (programInput !== undefined) {
        console.log('📺 Current program input:', programInput);
    }
});

myAtem.on('disconnected', () => {
    console.log('⚠️ Disconnected from ATEM');
});

myAtem.on('error', (err) => {
    console.error('❌ Connection error:', err);
});

// Replace this with your ATEM's IP
myAtem.connect('192.168.1.240');
