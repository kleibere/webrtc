let DefaultServerConfig = {
    domain: 'sbc.bestsol.pe',
    addresses: ['wss://sbc.bestsol.pe:8061'],
    iceServers: [],
    version: '18-Nov-2020'
}

let DefaultPhoneConfig = {
    reconnectIntervalMin: 2, // Minimum interval between WebSocket reconnection attempts. (seconds)
    reconnectIntervalMax: 30, // Maximum interval between WebSocket reconnection attempts (seconds)
    registerExpires: 600,     // SIP registration expiry time (seconds) 
    useSessionTimer: false,   // Enable Session Timers (as per RFC 4028)
    keepAlivePing: 10,        // To detect websocket disconnection, send CRLF ping interval (seconds) 
    keepAlivePong: 10,        // Wait pong response interval (seconds)
    keepAliveStats: 60,       // Each n pongs print to console log min and max pong delay
    keepAliveDist: false,     // Print to console log also pong distribution.
    restoreCall: true,        // Restore call if HTML page was reloaded during call.
    restoreServer: true,      // After page reload arise priority of previously connected SBC
    restoreCallMaxDelay: 20,  // Maximum interval to restore call (seconds)
    dtmfUseWebRTC: true,      // Send DTMF using RTP as per RFC2833 (otherwise use SIP INFO)
    dtmfDuration: null,       // Duration of the DTMF tone (milliseconds) Default is 250
    dtmfInterToneGap: null,   // Interval between two DTMF tones (milliseconds) Default is 250
    avoidTwoWayHold: true,    // If call in remote hold, disable local hold button to avoid 2 way holds.
    enableAddVideo: true,     // Enable to call remote side to add video stream.
    addLoggerTimestamp: true, // Always add timestamp string to log.
    useWebrtcTracer: false,   // Use advanced WebRTC methods logging tools.
    audioAutoAnswerNoSdp: true, // Use audio for auto answer to incoming INVITE without SDP
    switchSbcAtInvite5xx: true, // When outgoing call answer 5xx switch to alternative SBC and re-call.
    // SDK modes and fixes.
    modes: {
        ice_timeout_fix: 2000,                // ICE gathering timeout (milliseconds)
        chrome_rtp_timeout_fix: 13,        // Workaround of https://bugs.chromium.org/p/chromium/issues/detail?id=982793
        sbc_ha_pairs_mode: undefined,      // After SBC disconnection try reconnect to the same URL.
        ringing_header_mode: 'Allow-Events: talk,hold,conference' // Extra header(s) to response 180.                             // Only for multiple SBC HA pairs configuration.
    },
    // Set browser constraints.
    constraints: {
        chrome: { audio: { echoCancellation: true } },
        firefox: { audio: { echoCancellation: true } },
        safari: { audio: { echoCancellation: true } },
        ios_safari: { audio: { echoCancellation: true } }
    },
    version: '18-Nov-2020'
}

let DefaultUserPref = {
    hideLocalVideo: false, // when open remote video hide local video.
    videoSize: 'Small', // Default,Tiny,X Small,Small,Medium,Large,X Large,Huge, or Custom
    answeringMachine: { // For compatibility with phone prototype with answering machine.
        use: true,
        startDelay: 16,
        recordDuration: 20,
        newRecord: false,
    },
    videoCustom: {
        local: {
            size: 'Tiny',
            top: 'auto',
            left: 'auto'
        },
        remote: {
            size: 'Small',
            top: 'auto',
            left: 'auto'
        }
    },
    conference: {
        layout: 'compact',
        fps: 10,
        size: 'Small'
    },
    version: '18-Nov-2020'
}

let SoundConfig = {
    generateTones: {
        // Phone ringing, busy and other tones vary in different countries.
        // Please see: https://www.itu.int/ITU-T/inr/forms/files/tones-0203.pdf

        /* Germany
         ringingTone: [{ f: 425, t: 1.0 }, { t: 4.0 }],
         busyTone: [{ f: 425, t: 0.48 }, { t: 0.48 }],
         disconnectTone: [{ f: 425, t: 0.48 }, { t: 0.48 }],
         autoAnswerTone: [{ f: 425, t: 0.3 }]
        */

        /* France
         ringingTone: [{f:400, t:1.5}, {t:3.5}],
         busyTone: [{ f: 400, t: 0.5 }, { t: 0.5 }],
         disconnectTone: [{ f: 400, t: 0.5 }, { t: 0.5 }],
         autoAnswerTone: [{ f: 400, t: 0.3 }]
        */

        /* Great Britain */
         ringingTone: [{ f: [400, 450], t: 0.4 }, { t: 0.2 }, { f: [400, 450], t: 0.4 }, { t: 2.0 }],
         busyTone: [{ f: 400, t: 0.375 }, { t: 0.375 }],
         disconnectTone: [{ f: 400, t: 0.375 }, { t: 0.375 }],
         autoAnswerTone: [{ f: 400, t: 0.3 }],
        
        /* auto answering machine beep */
         beep: [{ t: 1.0 }, { f: 1000, t: 0.4 }, { t: 0.1 }]
    },
    downloadSounds: [
        { ring: 'ring1' }, // ring1 by default (user can select other ring)
        'bell'
    ],
    play: {
        outgoingCallProgress: { name: 'ringingTone', loop: true, volume: 0.2 },
        busy: { name: 'busyTone', volume: 0.2, repeat: 4 },
        disconnect: { name: 'disconnectTone', volume: 0.2, repeat: 3 },
        autoAnswer: { name: 'autoAnswerTone', volume: 0.2 },
        incomingCall: { name: 'ring', loop: true, volume: 1.0, dropDisabled: true },
        incomingMessage: { name: 'bell', volume: 1.0 },
        dtmf: { volume: 0.15 }
    },
    version: '18-Nov-2020'
}