'use strict';
/*
 * AudioCodes WebRTC API v1.13.0
 * © 2020 AudioCodes Ltd. All rights reserved.
 */
class AudioCodesUA {
    constructor() {
        this._isInitialized = false;
        this.serverConfig = {};
        this.account = {
            user: null,
            userAuth: null,
            displayName: null,
            password: null,
            registerExpires: 600,
            useSessionTimer: false
        };
        this.constraints = {
            chrome: { audio: true, video: true },
            firefox: { audio: true, video: true },
            safari: { audio: true, video: true },
            ios_safari: { audio: true, video: true },
            other: { audio: true, video: true }
        };
        this.chromiumBased = [
            { n: 'Edge', s: 'edg/' },
            { n: 'Opera', s: 'opr/' },
            { n: 'Samsung', s: 'samsungbrowser/' },
            { n: 'Yandex', s: 'yabrowser/' }
        ];
        this.modes = { // default values for modes and fixes.
            video_call_audio_answer_fix: true, // Video call/audio answer - answer side no sound issue.
            ice_timeout_fix: 2000,             // ICE gathering timeout (ms)
            chrome_rtp_timeout_fix: 13,        // Currently Chrome don't set 'failed' status to icestate
            sbc_ha_pairs_mode: undefined,      // Set e.g. 15 (seconds) when used multiple URL of HA SBC pairs
            ringing_header_mode: undefined     // Add extra header(s) to response 180 ringing
        };
        this.listeners = {};
        this.registerExtraHeaders = null;
        this.jssipUA = null;
        this.browser = '';       // chrome, firefox, edge, other
        this.browserVersion = 0; // version major number.
        this.browserName = '';   // name with version
        this.reconnectMin = 2;
        this.reconnectMax = 30;
        this.u17 = undefined;
        this.wsSocket = null;
        this.wsOnMessage = null;
        this.wsPingTask = null;
        this.wsPongTask = null;
        this.wsPingMs = 0;
        this.wsPongMs = 0;
        this.wsWasPong = false;
        this.wsPongStats = 0;
        this.wsPongStatNum = 0;
        this.wsPongStatTime = 0;
        this.wsPongStatDelayMin = 1000000;
        this.wsPongStatDelayMax = 0;
        this.wsPongStatDist = null;
        this.dtmfUseWebRTC = true;
        this.dtmfDuration = 250;
        this.dtmfInterToneGap = 250;
        this.enableAddVideo = false;
        this.oauthToken = null;
        this.oauthTokenUseInInvite = true;
        AudioCodesUA.ac_log = console.log;
        if (typeof (AudioCodesUA.instance === 'undefined'))
            AudioCodesUA.instance = this;
        this._detectBrowser();
        this.webrtcapi = AudioCodesWebRTCWrapper;
        this.replacedCall = null;
        this.AUDIO = Symbol('audio');
        this.VIDEO = Symbol('video');
        this.RECVONLY_VIDEO = Symbol('recvonly_video');
        return AudioCodesUA.instance;
    }

    version() { return '1.13.0'; }
    getBrowserName() { return this.browserName; }
    getBrowser() { return this.browser; }
    getBrowserVersion() { return this.browserVersion; }

    getWR() { return this.webrtcapi; }
    checkAvailableDevices() { return this.getWR().checkAvailableDevices(); }

    getServerAddress() {
        if (this.wsSocket === null)
            return null;
        let url = this.wsSocket.url;
        if (url.endsWith('/'))
            url = url.slice(0, -1);
        return url;
    }

    setOAuthToken(token, useInInvite = true) {
        this.oauthToken = token;
        this.oauthTokenUseInInvite = useInInvite;
        this.setRegisterExtraHeaders(this.registerExtraHeaders);
    }

    setUserAgent(name) {
        this.u17 = name;
    }

    // Obsolete. Use: setConstraints('chrome', 'audio', ...)
    setChromeAudioConstraints(str) {
        AudioCodesUA.ac_log('AC: setChromeAudioConstraints= ' + str);
        let modes = str.split(',').map(l => l.trim()).filter(l => l.length > 0);
        let c;
        if (modes.length === 0) {
            c = true;
        } else {
            c = {};
            for (let m of modes) {
                c[m] = true;
            }
        }
        this.setConstraints('chrome', 'audio', c);
    }

    /* Set audio or video constraints for the browser.
     *
     * browser: 'chrome', 'firefox', 'safari', 'other'.
     * (or phone.browser - currently used browser)
     *
     * type: 'audio' or 'video'
     *
     * value: true/false or arbitrary constraints object e.g.
     *  {echoCancellation: { exact: true }}
     */
    setConstraints(browser, type, value) {
        AudioCodesUA.ac_log('AC: setConstraints ' + browser + ' ' + type, value);
        if (this.constraints[browser] === undefined)
            throw 'Unsupported browser: ' + browser;
        if (this.constraints[browser][type] === undefined)
            throw 'Wrong type: ' + type;
        this.constraints[browser][type] = value;
    }

    /*
     * Set constraints for set of browsers
     */
    setBrowsersConstraints(arg) {
        for (let key of Object.keys(arg)) {
            let browser = arg[key];
            if (browser.audio !== undefined)
                this.setConstraints(key, 'audio', browser.audio);
            if (browser.video !== undefined)
                this.setConstraints(key, 'video', browser.video);
        }
    }

    setServerConfig(serverAddresses, serverDomain, iceServers = []) {
        this.serverConfig = {
            addresses: serverAddresses,
            domain: serverDomain,
            iceServers: this._convertIceList(iceServers)
        };
        AudioCodesUA.ac_log('AC: setServerConfig()', this.serverConfig);
    }

    setReconnectIntervals(minSeconds, maxSeconds) {
        AudioCodesUA.ac_log('AC: setReconnectIntervals min=' + minSeconds + ' max=' + maxSeconds);
        this.reconnectMin = minSeconds;
        this.reconnectMax = maxSeconds;
    }

    setAccount(user, displayName, password, authUser) {
        if (displayName === undefined || displayName === null || displayName.length === 0)
            displayName = undefined;
        if (authUser === undefined || authUser === null || authUser.length === 0)
            authUser = user;
        let a = this.account;
        a.user = user;
        a.displayName = displayName;
        a.password = password;
        a.authUser = authUser;
    }

    setRegisterExpires(seconds) {
        AudioCodesUA.ac_log('AC: setRegisterExpires=' + seconds);
        this.account.registerExpires = seconds;
    }

    setUseSessionTimer(use) {
        AudioCodesUA.ac_log('AC: setUseSessionTimer=' + use);
        this.account.useSessionTimer = use;
    }

    // null value means use default (see value set in constructor for dtmfDuration, dtmtInterToneGap, dtmfSendDelay).
    setDtmfOptions(useWebRTC, duration = null, interToneGap = null) {
        AudioCodesUA.ac_log(`AC: setDtmfOptions useWebRTC=${useWebRTC} duration=${duration} interToneGap=${interToneGap}`);
        this.dtmfUseWebRTC = useWebRTC;
        if (duration !== null)
            this.dtmfDuration = duration;
        if (interToneGap !== null)
            this.dtmfInterToneGap = interToneGap;
    }

    setEnableAddVideo(enable) {
        AudioCodesUA.ac_log('AC: setEnableAddVideo=' + enable);
        this.enableAddVideo = enable;
    }
    getEnableAddVideo() { return this.enableAddVideo; }

    getAccount() { return this.account; }

    setListeners(listeners) {
        AudioCodesUA.ac_log('AC: setListeners()');
        for (let m of ['loginStateChanged', 'outgoingCallProgress', 'callTerminated',
            'callConfirmed', 'callShowStreams', 'incomingCall', 'callHoldStateChanged']) {
            if (m in listeners)
                continue;
            throw 'listener missed method: ' + m;
        }

        this.listeners = listeners;
    }

    static getSessionStatusName(status) {
        switch (status) {
            case 0: return 'NULL (0)';
            case 1: return 'INVITE_SENT (1)';
            case 2: return '1XX_RECEIVED (2)';
            case 3: return 'INVITE_RECEIVED (3)';
            case 4: return 'WAITING_FOR_ANSWER (4)';
            case 5: return 'ANSWERED (5)';
            case 6: return 'WAITING_FOR_ACK (6)';
            case 7: return 'CANCELED (7)';
            case 8: return 'TERMINATED (8)';
            case 9: return 'CONFIRMED (9)';
            default: return 'Unknown (' + status + ')';
        }
    }

    setJsSipLogger(loggerFunction) { JsSIP.debug.log = loggerFunction; }

    setAcLogger(loggerFunction) { AudioCodesUA.ac_log = loggerFunction; }

    isInitialized() { return this._isInitialized; }

    setModes(modes = {}) {
        AudioCodesUA.ac_log('AC: setModes() ' + JSON.stringify(modes));
        Object.assign(this.modes, modes);
        this._normalizeModes();
    }

    _normalizeModes() {
        function undef(v, m) { return typeof v === 'number' && v <= m ? undefined : v; }
        let m = this.modes;
        m.sbc_ha_pairs_mode = undef(m.sbc_ha_pairs_mode, 0);
        m.chrome_rtp_timeout_fix = undef(m.chrome_rtp_timeout_fix, 0);
    }

    init(autoLogin = true) {
        AudioCodesUA.ac_log('AC: init() autoLogin=' + autoLogin);
        if (this._isInitialized)
            return;
        this._isInitialized = true;
        JsSIP.debug.enable('JsSIP:*');
        JsSIP.debug.formatArgs = function () { }; // not add colors, module name and delay.

        let sockets = [];
        for (let address of this.serverConfig.addresses) {
            if (address instanceof Array) { // 'address' or ['address', weight]
                sockets.push({ socket: new JsSIP.WebSocketInterface(address[0]), weight: address[1] });
            } else {
                sockets.push(new JsSIP.WebSocketInterface(address));
            }
        }

        let config = {
            sockets: sockets,
            uri: 'sip:' + this.account.user + '@' + this.serverConfig.domain,
            contact_uri: 'sip:' + this.account.user + '@' + this._randomToken(12) + '.invalid;transport=ws',
            authorization_user: this.account.authUser,
            password: this.account.password,
            register: autoLogin,
            session_timers: this.account.useSessionTimer,
            register_expires: this.account.registerExpires,
            user_agent: this.u17,
            connection_recovery_min_interval: this.reconnectMin,
            connection_recovery_max_interval: this.reconnectMax
        };

        if (this.account.displayName && this.account.displayName.length > 0) {
            config.display_name = this.account.displayName;
        }

        this.jssipUA = new JsSIP.UA(config);
        this.setRegisterExtraHeaders(this.registerExtraHeaders);
        this._setUACallbacks();

        AudioCodesUA.ac_log('AC: applied SDK modes: ' + JSON.stringify(this.modes, (k, v) =>
            typeof v === 'undefined' ? '<undefined>' : v));
        this.jssipUA.modes = this.modes;
        this.jssipUA.start();
    }

    deinit() {
        this._isInitialized = false;
        this.jssipUA && this.jssipUA.stop();
    }


    /*
     *  Extra SIP headers.
     *  For example: ['X-Location: Haifa HaGanim 10', 'X-Attraction: Bahai Gardens']
     */
    setRegisterExtraHeaders(extraHeaders) {
        this.registerExtraHeaders = extraHeaders;
        if (this.jssipUA) {
            let headers = extraHeaders !== null ? extraHeaders : [];
            if (this.oauthToken !== null) {
                headers = headers.slice();
                headers.push('Authorization: Bearer ' + this.oauthToken);
            }
            this.jssipUA.registrator().setExtraHeaders(headers);
        }
    }

    /**
     * Send REGISTER (and periodically resend) to SBC server
     */
    login() {
        AudioCodesUA.ac_log('AC: login()');
        this.jssipUA.register();
    }

    logout() {
        AudioCodesUA.ac_log('AC: logout()');
        if (this.jssipUA.isRegistered()) {
            this.jssipUA.unregister();
        }
    }

    switchSBC() {
        AudioCodesUA.ac_log('AC: switchSBC()');
        this.jssipUA.switchSBC();
    }

    getNumberOfSBC() {
        return this.jssipUA.getNumberOfSBC();
    }

    /*
     * Phone can periodically check that SBC server is on-line.
     *
     * ping == 0 no use (default)
     *              > 0 send periodically CRLFCRLF to SBC to detect connectivity failure.
     * pong == 0 no check pong CRLF timeout
     *              > 0 pong timeout
     *              if server don't support pong (no one pong received) will be ignored.
     * stats = 0  0 means disabled, otherwise print pong delay stats each 'stats' pongs.
     *
     * pongDist false (default) collect pongs distribution (with interval 0.25 seconds)
     */
    setWebSocketKeepAlive(pingSeconds, pongSeconds = 0, pongStats = 0, pongDist = false) {
        AudioCodesUA.ac_log('AC: setWebSocketKeepAlive ping=' + pingSeconds + ' pong=' + pongSeconds + ' stats=' + pongStats + ' dist=' + pongDist);
        this.wsPingMs = pingSeconds * 1000;
        this.wsPongMs = pongSeconds * 1000;
        this.wsPongStats = pongStats;
        if (pongDist) {
            this.wsPongStatDist = new Array(pongSeconds * 4).fill(0);
        }
    }

    _onMessageHook(arg) {
        if (arg.data === '\r\n') {
            this._onPong();
        } else {
            this.wsOnMessage(arg);
        }
    }

    _onPong() {
        if (this.wsPongMs === 0)
            return;

        clearTimeout(this.wsPongTask);
        this.wsPongTask = null;

        if (!this.wsWasPong) {
            AudioCodesUA.ac_log('AC: keep-alive: Server supports CRLF pong');
            this.wsWasPong = true;
        }

        if (this.wsPongStats > 0) { // Is PONG statistics enabled ?
            let delay = Date.now() - this.wsPongStatTime;
            if (delay < this.wsPongStatDelayMin)
                this.wsPongStatDelayMin = delay;
            if (delay > this.wsPongStatDelayMax)
                this.wsPongStatDelayMax = delay;

            if (this.wsPongStatDist !== null) {
                let n = Math.floor(delay / 250);
                if (n >= this.wsPongStatDist.length)
                    n = this.wsPongStatDist.length - 1;
                this.wsPongStatDist[n]++;
            }

            this.wsPongStatNum++;
            if (this.wsPongStatNum == this.wsPongStats) {
                let dist = '';
                if (this.wsPongStatDist !== null) {
                    dist = '\r\n';
                    for (let i = 0; i < this.wsPongStatDist.length; i++) {
                        dist += this.wsPongStatDist[i].toString();
                        if (i !== this.wsPongStatDist.length - 1)
                            dist += (i + 1) % 4 === 0 ? ',' : ' ';
                    }
                    this.wsPongStatDist.fill(0);
                }
                AudioCodesUA.ac_log('AC: keep-alive: stats: pongs=%d delay=%d..%d ms' + dist, this.wsPongStatNum, this.wsPongStatDelayMin, this.wsPongStatDelayMax);
                this.wsPongStatNum = 0;
                this.wsPongStatDelayMin = 1000000;
                this.wsPongStatDelayMax = 0;
            }
        }
    }

    _onPongTimeout() {
        this.wsPongTask = null;
        if (!this.wsWasPong) {
            AudioCodesUA.ac_log('AC: keep-alive: Server does not support CRLF pong.');
            this.wsPongMs = 0;
            return;
        }
        AudioCodesUA.ac_log('AC: keep-alive: Pong timeout. Connection is failed');
        this._stopWsKeepAlive();
        try {
            this.wsSocket.close();
        } catch (e) {
            AudioCodesUA.ac_log('AC: close socket error', e);
        }
    }

    _startWsKeepAlive(websocket) {
        this.wsSocket = websocket;
        if (this.wsPingMs === 0)
            return;
        this.wsOnMessage = websocket.onmessage;
        websocket.onmessage = this._onMessageHook.bind(this);

        this._stopWsKeepAlive();
        this.wsPingTask = setInterval(function () {
            try {
                let ac = AudioCodesUA.instance;
                if (ac.wsPongMs > 0 && ac.wsPongTask === null) {
                    if (ac.wsPongStats > 0)
                        ac.wsPongStatTime = Date.now();
                    ac.wsPongTask = setTimeout(ac._onPongTimeout.bind(ac), ac.wsPongMs);
                }
                // AudioCodesUA.ac_log('AC: keep-alive ping');
                if (websocket.readyState === WebSocket.OPEN) {
                    websocket.send('\r\n\r\n');
                } else {
                    AudioCodesUA.ac_log('AC: Warning: Cannot send Ping, websocket state=' + websocket.readyState);
                }

            } catch (e) {
                AudioCodesUA.ac_log('AC: send keep-alive ping, error', e);
            }
        }, this.wsPingMs);
    }

    _stopWsKeepAlive() {
        if (this.wsPingTask !== null) {
            clearInterval(this.wsPingTask);
            this.wsPingTask = null;
        }
        if (this.wsPongTask !== null) {
            clearTimeout(this.wsPongTask);
            this.wsPongTask = null;
        }
    }

    // Catch some JsSIP events, and call corresponding API callbacks.
    _setUACallbacks() {
        this.jssipUA.on('connected', (e) => {
            AudioCodesUA.ac_log('AC>>: loginStateChanged: isLogin=false "connected"');
            this._startWsKeepAlive(e.socket.socket._ws);
            this.listeners.loginStateChanged(false, 'connected', null);
        });

        this.jssipUA.on('disconnected', (e) => {
            this._stopWsKeepAlive();
            AudioCodesUA.ac_log('AC>>: loginStateChanged: isLogin=false "disconnected"');
            this.listeners.loginStateChanged(false, 'disconnected', null);
        });

        this.jssipUA.on('registered', (e) => {
            AudioCodesUA.ac_log('AC>>: loginStateChanged: isLogin=true "login"');
            this.listeners.loginStateChanged(true, 'login', null);
        });

        this.jssipUA.on('unregistered', (e) => {
            AudioCodesUA.ac_log('AC>>: loginStateChanged: isLogin=false "logout"');
            this.listeners.loginStateChanged(false, 'logout', null);
        });

        this.jssipUA.on('registrationFailed', (e) => {
            if (e.response && e.response.status_code >= 300 && e.response.status_code < 400) {
                // Check if JsSIP includes the REGISTER 3xx redirect extension.
                if (this.jssipUA.registerRedirect) {
                    let contact = e.response.parseHeader('contact');
                    if (contact) {
                        let cu = contact.uri;
                        let url = 'wss://' + cu.host;
                        if (cu.port && cu.port !== 443) {
                            url += ':' + cu.port.toString();
                        }
                        AudioCodesUA.ac_log('AC>>: loginStateChanged: isLogin=false "redirection" ' + url);
                        if (this.jssipUA.registerRedirect(url)) {
                            return;
                        } else {
                            AudioCodesUA.ac_log('AC: redirect url missed in server addresses, please see setServerConfig()');
                        }
                    } else {
                        AudioCodesUA.ac_log('AC: 3xx response without "Contact" is ignored');
                    }
                } else {
                    AudioCodesUA.ac_log('AC: REGISTER 3xx redirection is not supported in the original JsSIP');
                }
            }

            AudioCodesUA.ac_log('AC>>: loginStateChanged: isLogin=false "login failed"');
            this.listeners.loginStateChanged(false, 'login failed', e.response ? e.response : null);
        });

        this.jssipUA.on('newMessage', (e) => {
            if (e.originator !== 'remote')
                return; // ignore outgoing message.
            AudioCodesUA.ac_log('AC>>: incomingMessage', e);
            if (this.listeners.incomingMessage) {
                // null, from, content-type?, body?, request
                this.listeners.incomingMessage(null, AudioCodesUA.instance._get_from(e.request), AudioCodesUA.instance._get_content_type(e.request), e.request.body, e.request);
            }
        });

        this.jssipUA.on('sipEvent', (e) => {
            if (!this.listeners.incomingNotify)
                return;
            AudioCodesUA.ac_log('AC>>: incoming out of dialog NOTIFY', e);
            // null, event, from, content-type? , body?, request
            this.listeners.incomingNotify(null, e.event ? e.event.event : null, AudioCodesUA.instance._get_from(e.request), AudioCodesUA.instance._get_content_type(e.request), e.request.body, e.request);
        });

        this.jssipUA.on('newRTCSession', function (e) {
            AudioCodesUA.ac_log(`AC: event ${e.originator === 'remote' ? 'incoming' : 'outgoing'} "newRTCSession"`, e);
            let call = new AudioCodesSession(e.session);
            // In-dialog incoming NOTIFY.
            // Works only in modified jssip where added the event
            call.js_session.on('sipEvent', function (e) {
                if (!AudioCodesUA.instance.listeners.incomingNotify)
                    return;
                let ac_session = this.data.ac_session;
                AudioCodesUA.ac_log('AC>>: incoming NOTIFY', ac_session, e);
                // call?, event, from, content-type? , body?, request. return true when notify accepted.
                e.taken = AudioCodesUA.instance.listeners.incomingNotify(ac_session, e.event ? e.event.event : null, AudioCodesUA.instance._get_from(e.request), AudioCodesUA.instance._get_content_type(e.request), e.request.body, e.request);
            });

            call.js_session.on('newInfo', function (e) {
                if (!AudioCodesUA.instance.listeners.incomingInfo)
                    return;
                if (e.originator === 'local')
                    return;
                let ac_session = this.data.ac_session;
                AudioCodesUA.ac_log('AC>>: incoming INFO', ac_session, e);
                // call, from, content-type? , body?, request
                AudioCodesUA.instance.listeners.incomingInfo(ac_session, AudioCodesUA.instance._get_from(e.request), AudioCodesUA.instance._get_content_type(e.request), e.request.body, e.request);
            });

            call.js_session.on('replaces', function (e) {
                AudioCodesUA.instance.replacedCall = this.data.ac_session;
                AudioCodesUA.ac_log('AC>>: incoming INVITE with Replaces. This call will be replaced:', this.data.ac_session);
                e.accept();
            });

            call.js_session.on('sdp', function (e) {
                AudioCodesUA.instance._sdp_checking(this, e);
            });

            call.js_session.on('connecting', function (e) {
                let ac_session = this.data.ac_session;
                let dir = ac_session.data['_answer_set_video_transceiver'];
                if (dir !== undefined) {
                    delete ac_session.data['_answer_set_video_transceiver'];
                    AudioCodesUA.ac_log('AC: Answer. Set video transceiver direction', ac_session);
                    let vt = AudioCodesUA.instance.getWR().connection.getTransceiver(this.connection, 'video');
                    if (vt !== null) {
                        AudioCodesUA.instance.getWR().transceiver.setDirection(vt, dir);
                    }
                }
            });

            call.js_session.on('reinvite', function (e) {
                if (!AudioCodesUA.instance.listeners.callIncomingReinvite)
                    return;
                let ac_session = this.data.ac_session;
                AudioCodesUA.ac_log('AC>>: callIncomingReinvite start');
                AudioCodesUA.instance.listeners.callIncomingReinvite(ac_session, true, e.request);
                e.callback = function () {
                    AudioCodesUA.ac_log('AC>>: callIncomingIncomingReinvite end');
                    AudioCodesUA.instance.listeners.callIncomingReinvite(ac_session, false, null);
                }
            });

            call.js_session.on('hold', function (e) {
                let ac_session = this.data.ac_session;
                let isRemote = e.originator === 'remote';
                AudioCodesUA.ac_log(`AC>>: callHoldStateChanged isHold=true isRemote=${isRemote} session:`, ac_session);
                AudioCodesUA.instance.listeners.callHoldStateChanged(ac_session, true, isRemote);
            });

            call.js_session.on('unhold', function (e) {
                let ac_session = this.data.ac_session;
                let isRemote = e.originator === 'remote';
                AudioCodesUA.ac_log(`AC>>: callHoldStateChanged isHold=false isRemote=${isRemote} session:`, ac_session);
                AudioCodesUA.instance.listeners.callHoldStateChanged(ac_session, false, isRemote);
            });

            call.js_session.on('progress', function (e) {
                if (e.originator === 'remote') {
                    let ac_session = this.data.ac_session;
                    AudioCodesUA.ac_log('AC>>: outgoingCallProgress', ac_session);
                    AudioCodesUA.instance.listeners.outgoingCallProgress(ac_session, e.response);
                }
            });

            call.js_session.on('failed', function (e) {
                let ac_session = this.data.ac_session;
                let contact = null;
                if (e.cause === 'Redirected' && e.message && e.message.headers) {
                    let nameAddress = e.message.parseHeader('Contact');
                    if (nameAddress) {
                        contact = nameAddress.uri.toString();
                    }
                }
                AudioCodesUA.ac_log('AC>>: callTerminated (failed)', ac_session, e.cause, contact);
                AudioCodesUA.instance.listeners.callTerminated(ac_session, e.message, e.cause, contact);
            });

            call.js_session.on('accepted', function (e) {
                let ac_session = this.data.ac_session;
                ac_session.data['_accepted'] = true; // means sent or received OK
                if (e.originator === 'remote') { // Outgoing call
                    ac_session.data['_ok_response'] = e.response;
                }
            });

            // Remove listener that close replaced session when replaces confirmed
            if (e.originator === 'remote' && AudioCodesUA.instance.replacedCall !== null)
                call.js_session.removeAllListeners('confirmed');

            call.js_session.on('confirmed', function (e) {
                let ac_session = this.data.ac_session;
                let okResponse = null;
                let cause;
                if ('_ok_response' in ac_session.data) {
                    okResponse = ac_session.data['_ok_response'];
                    delete ac_session.data['_ok_response'];
                    cause = 'ACK sent';
                } else {
                    cause = 'ACK received';
                }

                // Video call /audio answer, no sound in answer side issue. Firefox workaround
                if (call.data['_video_call_audio_answer'] && 'firefox' === AudioCodesUA.instance.browser) {
                    call.data['_video_call_audio_answer'] = false;
                    AudioCodesUA.ac_log('AC: [video call/audio answer] Send re-INVITE');
                    call.sendReInvite({ showStreams: true });
                }

                AudioCodesUA.ac_log('AC>>: callConfirmed', ac_session, cause);
                AudioCodesUA.instance.listeners.callConfirmed(ac_session, okResponse, cause);
            });

            call.js_session.on('ended', function (e) {
                let ac_session = this.data.ac_session;
                AudioCodesUA.ac_log('AC>>: callTerminated (ended)', ac_session, e.cause);
                AudioCodesUA.instance.listeners.callTerminated(ac_session, e.message, e.cause);
            });

            call.js_session.on('refer', function (e) {
                if (!AudioCodesUA.instance.listeners.transfereeCreatedCall) {
                    AudioCodesUA.ac_log('AC>>: incoming REFER rejected, because transfereeCreatedCall is not set');
                    e.reject();
                } else {
                    let ac_session = this.data.ac_session;
                    let accept;
                    if (AudioCodesUA.instance.listeners.transfereeRefer) {
                        accept = AudioCodesUA.instance.listeners.transfereeRefer(ac_session, e.request);
                    } else {
                        accept = true;
                    }
                    if (accept) {
                        AudioCodesUA.ac_log('AC>>: incoming REFER accepted');
                        // Set new call video according current call.
                        let options = AudioCodesUA.instance._callOptions(ac_session.hasSendVideo(), true);
                        e.accept((e) => { e.data['_created_by_refer'] = ac_session; }, options);
                    } else {
                        AudioCodesUA.ac_log('AC>>: incoming REFER rejected');
                        e.reject();
                    }
                }
            });

            // Set the call flag according phone setting.
            call._setEnabledReceiveVideo(AudioCodesUA.instance.enableAddVideo);

            // If connection is already exists set listener.
            // otherwise wait until connection will be created.
            if (call.js_session.connection) {
                AudioCodesUA.instance._set_connection_listener(call);
                AudioCodesUA.ac_log('AC: connection exists, set "track" listener');
            } else {
                AudioCodesUA.ac_log('AC: peer connection does not exist, wait creation');
                call.js_session.on('peerconnection', (ee) => {
                    AudioCodesUA.instance._set_connection_listener(call);
                    AudioCodesUA.ac_log('AC: [event connection] connection created, set "track" listener');
                });
            }

            let remote;
            if (e.originator === 'remote') {
                remote = e.request.from;
            } else {
                remote = e.request.to;
            }

            // set call data
            call.data['_user'] = remote.uri.user;
            call.data['_host'] = remote.uri.host;
            call.data['_display_name'] = remote.display_name; // optional
            call.data['_create_time'] = new Date();

            if (e.originator === 'remote') {
                let replacedCall = null;
                if (AudioCodesUA.instance.replacedCall !== null) {
                    replacedCall = AudioCodesUA.instance.replacedCall;
                    AudioCodesUA.instance.replacedCall = null;
                }

                // Incoming call. Set video flags according m=video in SDP.
                let send, recv, vdir, hasSDP;
                if (e.request.body) {
                    hasSDP = true;
                    let sdp = new AudioCodesSDP(e.request.body);
                    [send, recv, vdir] = sdp.getMediaDirection('video', true);
                } else {
                    hasSDP = false;
                    vdir = '';
                    send = recv = true; // to enable answer with or without video.
                    AudioCodesUA.ac_log('AC: warning incoming INVITE without SDP');
                }
                call._setVideoState(send, recv);

                AudioCodesUA.ac_log(`AC>>: incomingCall ${call.hasVideo() ? 'video' : 'audio'} from "${call.data._display_name}" ${call.data._user}`, call, replacedCall);
                AudioCodesUA.instance.listeners.incomingCall(call, e.request, replacedCall, hasSDP);
            } else { // e.originator === 'local'
                if (call.js_session.data['_created_by_refer']) {
                    AudioCodesUA.ac_log('AC>>: outgoing call created by REFER');
                    call.data['_created_by_refer'] = call.js_session.data['_created_by_refer'];
                    AudioCodesUA.instance.listeners.transfereeCreatedCall(call);
                } else {
                    AudioCodesUA.ac_log('AC>>: outgoing call created by phone.call()');
                }
            }
        });
    }

    _get_from(msg) {
        return {
            user: msg.from.uri.user,
            host: msg.from.uri.host,
            displayName: msg.from.display_name ? msg.from.display_name : null
        };
    }

    _get_content_type(msg) {
        let ct = msg.headers['Content-Type'];
        return (ct && ct.length > 0) ? ct[0].parsed : null;
    }

    _set_connection_listener(call) {
        AudioCodesUA.instance.getWR().connection.addEventListener(call.js_session.connection, 'track', (e) => {
            AudioCodesUA.ac_log('AC>>: "track"  event kind: ' + e.track.kind, e);
            // save call remote stream
            if (e.streams.length > 0) { // if track is in stream
                let stream = e.streams[0];
                AudioCodesUA.ac_log('AC: set call remote stream: ' + stream.id, call);
                call.data['_remoteMediaStream'] = stream;
            } else {
                AudioCodesUA.ac_log('AC: Warning "track" event without stream');
            }
            if (e.track.kind === 'video') {
                if (!call.hasEnabledReceiveVideo()) {
                    // Video call - audio answer, no sound in answer side issue. Patch for Safari.
                    // Chrome 87 works without the fix. Remove 'chrome' from the list 
                    if (call.data['_video_call_audio_answer'] && ['safari', 'ios_safari'].includes(AudioCodesUA.instance.browser)) {
                        e.track.onmute = () => {
                            AudioCodesUA.ac_log('AC: [video call/audio answer] Fired video track "mute" event.  Call callShowStream');
                            e.track.onmute = null;
                            let localStream = call.getRTCLocalStream();
                            let remoteStream = call.getRTCRemoteStream();
                            AudioCodesUA.ac_log('AC>>: callShowStreams', call, localStream, remoteStream);
                            AudioCodesUA.instance.listeners.callShowStreams(call, localStream, remoteStream);
                        }
                        AudioCodesUA.ac_log('AC: [video call/audio answer] Set video track "mute" event listener');
                        call.data['_video_call_audio_answer'] = false;
                    }

                    AudioCodesUA.ac_log('AC>>: event "track" video and !hasEnabledReceiveVideo therefore change transceiver direction.', call);
                    let vt = AudioCodesUA.instance.getWR().connection.getTransceiver(call.js_session.connection, 'video');
                    if (vt !== null) {
                        let dir = call.hasEnabledSendVideo() ? 'sendonly' : 'inactive';
                        AudioCodesUA.instance.getWR().transceiver.setDirection(vt, dir);
                    }
                }
                // No call callShowStreams() for event 'track' video, because we use the same stream for audio and video.
                // and to prevent calling callShowStreams twice and use wrong video flags.
                return;
            }
            let localStream = call.getRTCLocalStream();
            let remoteStream = call.getRTCRemoteStream();
            AudioCodesUA.ac_log('AC>>: callShowStreams', call, localStream, remoteStream);
            AudioCodesUA.instance.listeners.callShowStreams(call, localStream, remoteStream);
        });
    }

    /* 
       SDP may change with every new browser release and modified by SBC
       We do not edit the SDP in client to avoid chaos.
       However, it could be useful for testing
           
    // Remove ICE candidates with with a type different from 'relay'
    _sdp_editing(sdp) {
        for (let mIndex = 0; mIndex < sdp.media.length; mIndex++) {
            let media = sdp.media[mIndex];
            let modifiedMedia = [];
            for (let i = 0; i < media.length; i++) {
                let line = media[i];
                if (line.startsWith('a=candidate:')) {
                    // a=candidate:1467250027 1 udp 2122260223 192.168.0.196 46243 typ host generation 0
                    let tokens = line.split(' ');
                    if (tokens[7] === 'relay') {
                        modifiedMedia.push(line);
                    } else {
                        AudioCodesUA.ac_log('Removed line:' + line);
                    }
                } else {
                    modifiedMedia.push(line);
                }
            }
            sdp.media[mIndex] = modifiedMedia;
        }
        return sdp.toString();
    }

    // Usage:
    e.sdp = AudioCodesUA.instance._sdp_editing(sdp);
    */

    _sdp_checking(js_session, e) {
        let type = e.originator + ' ' + e.type;
        let ac_session = js_session.data.ac_session;
        let sdp, send, recv;
        try {
            sdp = new AudioCodesSDP(e.sdp);
            [send, recv] = sdp.getMediaDirection('video', e.originator === 'remote');
        } catch (e) {
            AudioCodesUA.ac_log('AC: cannot parse SDP', e);
            return;
        }
        let initial = ac_session.data._initial;
        if (e.type === 'answer') // after 1st answer it's not initial SDP negotiation.
            ac_session.data._initial = false;

        AudioCodesUA.ac_log(`AC: Event "sdp" ${initial ? 'initial' : ''} ${type}   Session state:${AudioCodesUA.getSessionStatusName(js_session._status)}`);
        switch (type) {
            case 'remote offer':
                break;

            case 'remote answer':
                if (ac_session.isLocalHold() || ac_session.isRemoteHold())
                    break; // ignore hold re-INVITE
                ac_session._setVideoState(send, recv);
                break;

            case 'local offer':
                break;

            case 'local answer':
                if (ac_session.isLocalHold() || ac_session.isRemoteHold())
                    break;  // ignore hold re-INVITE
                ac_session._setVideoState(send, recv);
                break;
        }
    }

    _convertIceList(ices) {
        let result = [];
        for (let entry of ices) {
            // convert short form of stun server to object
            if (typeof entry === 'string') {
                entry = { 'urls': 'stun:' + entry };
            }
            result.push(entry);
        }
        return result;
    }

    _randomToken(size) {
        let t = '';
        for (let i = 0; i < size; i++)
            t += Math.floor(Math.random() * 36).toString(36);
        return t;
    }

    _detectBrowser() {
        try {
            let ua = navigator.userAgent;
            this.browser = 'other';
            this.browserName = ua;
            this.browserVersion = 0;
            if (navigator.mozGetUserMedia) {
                this.browser = 'firefox'
                this.browserName = ua.match(/Firefox\/([.\d]+)$/)[0];
                this.browserVersion = parseInt(ua.match(/Firefox\/(\d+)\./)[1], 10);
            } else if (navigator.webkitGetUserMedia) { // Only works for secure connection.
                this.browser = 'chrome';
                this.browserName = ua.match(/Chrom(e|ium)\/([.\d]+)/)[0];
                this.browserVersion = parseInt(ua.match(/Chrom(e|ium)\/(\d+)\./)[2], 10);
                // Detect known Chromium based browsers: Edge, Opera etc - classified as 'chrome'
                let ual = ua.toLowerCase();
                for (let ix = 0; ix < this.chromiumBased.length; ix++) {
                    let s = this.chromiumBased[ix].s;
                    let f = ual.indexOf(s);
                    if (f !== -1) {
                        let v = ual.substring(f + s.length).match(/([.\d]+)/)[1];
                        this.browserName += ' (' + this.chromiumBased[ix].n + '/' + v + ')';
                        break;
                    }
                }
            } else if (window.safari) {
                this.browser = 'safari';
                this.browserName = 'Safari/' + ua.match(/Version\/([.\d]+)/)[1];
                this.browserVersion = parseInt(ua.match(/Version\/(\d+)\./)[1], 10);
            } else if (ua.indexOf('Edge/') !== -1) { // legacy Edge
                this.browser = 'other';
                this.browserName = ua.match(/Edge\/([.\d]+)/)[0];
                this.browserVersion = parseInt(ua.match(/Edge\/(\d+).(\d+)$/)[2], 10);
            }

            if (/iPad|iPhone|iPod/.test(ua)) {
                this.browser = 'ios_safari'; // WebRTC in iOS supported only in Safari.
                this.browserName = ua;
                this.browserVersion = 0;
            }
        } catch (e) {
            AudioCodesUA.ac_log('AC: Browser detection error', e);
            this.browser = 'other';
            this.browserName = navigator.userAgent;
            this.browserVersion = 0;
        }
    }

    _callOptions(sendVideo, isOutgoing, extraHeaders = null, extraOptions = null) {
        let options = {};
        if (extraOptions !== null) {
            Object.assign(options, extraOptions);
        }
        // mediaConstraints
        options.mediaConstraints = { 'audio': this.constraints[this.browser].audio };
        if (sendVideo) {
            options.mediaConstraints.video = this.constraints[this.browser].video;
        }

        // pcConfig
        if (options.pcConfig === undefined) {
            options.pcConfig = {};
        }
        options.pcConfig.iceServers = this.serverConfig.iceServers;

        // extraHeaders
        if (extraHeaders !== null) {
            extraHeaders = extraHeaders.slice();
        }
        if (this.oauthToken !== null && this.oauthTokenUseInInvite && isOutgoing) {
            if (extraHeaders === null) {
                extraHeaders = [];
            }
            extraHeaders.push('Authorization: Bearer ' + this.oauthToken);
        }
        if (extraHeaders !== null) {
            options.extraHeaders = extraHeaders;
        }
        return options;
    }

    /**
     * videoOption = phone.AUDIO, phone.VIDEO or false(=phone.AUDIO) true(=phone.VIDEO)
     */
    call(videoOption, call_to, extraHeaders = null, extraOptions = null) {
        // Convert boolean value to Symbol
        if (videoOption === false)
            videoOption = AudioCodesUA.instance.AUDIO;
        else if (videoOption === true)
            videoOption = AudioCodesUA.instance.VIDEO;

        if (typeof videoOption !== 'symbol' || ![AudioCodesUA.instance.AUDIO, AudioCodesUA.instance.VIDEO].includes(videoOption))
            throw 'Illegal videoOption=' + videoOption.toString();

        AudioCodesUA.ac_log(`AC: call ${videoOption.description} to ${call_to}`);
        let options = this._callOptions(videoOption === AudioCodesUA.instance.VIDEO, true, extraHeaders, extraOptions);
        let js_session = this.jssipUA.call(call_to, options);
        if (options.mediaStream)
            js_session._localMediaStreamLocallyGenerated = true; // to enable jssip close the stream
        let ac_session = js_session.data.ac_session;
        ac_session._setEnabledSendVideo(videoOption === AudioCodesUA.instance.VIDEO);
        if (videoOption === AudioCodesUA.instance.VIDEO)
            ac_session._setEnabledReceiveVideo(true);
        return ac_session;
    }

    sendMessage(to, body, contentType = 'text/plain') {
        AudioCodesUA.ac_log(`AC: sendMessage to: ${to} "${body}"`);
        return new Promise((resolve, reject) => {
            let options = {
                contentType: contentType,
                eventHandlers: { succeeded: (e) => resolve(e), failed: (e) => reject(e) }
            }
            this.jssipUA.sendMessage(to, body, options);
        });
    }
};

/*
 * Session
 */
class AudioCodesSession {
    constructor(js_session) {
        this.js_session = js_session;
        this.data = {
            _user: null,
            _display_name: null,
            _create_time: null,
            _initial: true,
            _remoteMediaStream: null,
            _wasUsedSendVideo: false,
            _screenSharing: null,
            _video: {
                send: false,
                receive: false,
                enabledSend: false,
                enabledReceive: false
            }
        };
        js_session.data.ac_session = this;
    }

    getRTCPeerConnection() { return this.js_session.connection; }
    getRTCLocalStream() { return this.js_session._localMediaStream; }
    getRTCRemoteStream() { return this.data['_remoteMediaStream']; }
    isEstablished() { return this.js_session.isEstablished(); }
    isTerminated() { return this.js_session.isEnded(); }
    isOutgoing() { return this.js_session.direction === 'outgoing'; }
    isAudioMuted() { return this.js_session.isMuted().audio; }
    isVideoMuted() { return this.js_session.isMuted().video; }
    wasAccepted() { return this.data['_accepted'] === true; }

    getReplacesHeader() {
        if (!this.js_session.isEstablished() || !this.js_session._dialog) {
            AudioCodesUA.ac_log('getReplacesHeader(): call is not established');
            return null;
        }
        let id = this.js_session._dialog.id;
        return `${id.call_id};to-tag=${id.remote_tag};from-tag=${id.local_tag}`;
    }

    muteAudio(set) {
        AudioCodesUA.ac_log(`AC: muteAudio() arg=${set} `);
        if (set) {
            this.js_session.mute({ audio: true, video: false });
        } else {
            this.js_session.unmute({ audio: true, video: false });
        }
    }

    muteVideo(set) {
        AudioCodesUA.ac_log(`AC: muteVideo() arg=${set} `);
        if (set) {
            this.js_session.mute({ audio: false, video: true });
        } else {
            this.js_session.unmute({ audio: false, video: true });
        }
    }

    sendDTMF(tone) {
        let useWebRTC = AudioCodesUA.instance.dtmfUseWebRTC;
        if (['safari', 'ios_safari'].includes(AudioCodesUA.instance.browser)) {
            useWebRTC = false;
        }
        AudioCodesUA.ac_log(`AC: sendDTMF() tone=${tone} ${useWebRTC ? '[RFC2833]' : '[INFO]'}`);
        let options = {
            duration: AudioCodesUA.instance.dtmfDuration,
            interToneGap: AudioCodesUA.instance.dtmfInterToneGap,
            transportType: useWebRTC ? 'RFC2833' : 'INFO'
        };
        this.js_session.sendDTMF(tone, options);
    }

    sendInfo(body, contentType, extraHeaders = null) {
        AudioCodesUA.ac_log('AC: sendInfo()', body, contentType, extraHeaders);
        let options = (extraHeaders !== null) ? { extraHeaders: extraHeaders } : undefined;
        this.js_session.sendInfo(contentType, body, options);
    }

    duration() {
        let start = this.js_session.start_time;
        if (!start)
            return 0;
        let end = this.js_session.end_time;
        if (!end)
            end = new Date();
        return Math.floor((end.getTime() - start.getTime()) / 1000);
    }

    // Call actual video state.
    // Set by initial INVITE and re-INVITEs. HOLD re-INVITEs will be ignored.
    hasSendVideo() { return this.data._video.send; }
    hasReceiveVideo() { return this.data._video.receive; }
    hasVideo() { return this.hasSendVideo() && this.hasReceiveVideo(); }
    getVideoState() {
        if (this.hasSendVideo() && this.hasReceiveVideo()) return "sendrecv";
        if (this.hasSendVideo()) return "sendonly";
        if (this.hasReceiveVideo()) return "recvonly";
        return "inactive";
    }
    _setVideoState(send, receive) {
        AudioCodesUA.ac_log(`AC: _setVideoState(send=${send}, receive=${receive})`);
        this.data._video.send = send;
        this.data._video.receive = receive;
    }

    // Call enabled to send/receive video
    hasEnabledSendVideo() { return this.data._video.enabledSend; }
    hasEnabledReceiveVideo() { return this.data._video.enabledReceive; }
    getEnabledVideoState() {
        if (this.hasEnabledSendVideo() && this.hasEnabledReceiveVideo()) return "sendrecv";
        if (this.hasEnabledSendVideo()) return "sendonly";
        if (this.hasEnabledReceiveVideo()) return "recvonly";
        return "inactive";
    }
    _setEnabledSendVideo(enable) {
        AudioCodesUA.ac_log(`AC: _setEnabledSendVideo(${enable})`);
        this.data._video.enabledSend = enable;
    }
    _setEnabledReceiveVideo(enable) {
        AudioCodesUA.ac_log(`AC: _setEnabledReceiveVideo(${enable})`);
        this.data._video.enabledReceive = enable;
    }

    /**
     * videoOption = phone.AUDIO, phone.VIDEO, phone.RECVONLY_VIDEO
     * or false (=phone.AUDIO), true(=phone.VIDEO)
     */
    answer(videoOption, extraHeaders = null, extraOptions = null) {
        if (this.data['_answer_called']) {
            AudioCodesUA.ac_log('AC: answer() is already called. [Ignored]');
            return;
        }
        this.data['_answer_called'] = true;

        // Convert boolean value to Symbol
        if (videoOption === false)
            videoOption = AudioCodesUA.instance.AUDIO;
        else if (videoOption === true)
            videoOption = AudioCodesUA.instance.VIDEO;

        if (typeof videoOption !== 'symbol' || ![AudioCodesUA.instance.AUDIO, AudioCodesUA.instance.RECVONLY_VIDEO, AudioCodesUA.instance.VIDEO].includes(videoOption))
            throw 'Illegal videoOption=' + videoOption.toString();

        AudioCodesUA.ac_log(`AC: ${videoOption.description} answer`);

        if (!this.hasVideo() && (videoOption === AudioCodesUA.instance.RECVONLY_VIDEO || videoOption === AudioCodesUA.instance.VIDEO)) {
            AudioCodesUA.ac_log('AC: incoming INVITE without video, so answer can be only "audio"');
            videoOption = AudioCodesUA.instance.AUDIO;
        }

        if (this.hasVideo()) {
            if (videoOption === AudioCodesUA.instance.AUDIO) {
                this.data['_answer_set_video_transceiver'] = 'inactive';
                if (AudioCodesUA.instance.modes.video_call_audio_answer_fix && ['safari', 'ios_safari', 'firefox'].includes(AudioCodesUA.instance.browser)) {
                    this.data['_video_call_audio_answer'] = true; // Mark the case.
                }
            } else if (videoOption === AudioCodesUA.instance.RECVONLY_VIDEO) {
                this.data['_answer_set_video_transceiver'] = 'recvonly';
            }
        }

        // Set enabled and current send/receive video flags
        switch (videoOption) {
            case AudioCodesUA.instance.AUDIO:
                this._setEnabledSendVideo(false);
                this._setEnabledReceiveVideo(this.hasVideo() ? false : AudioCodesUA.instance.enableAddVideo);
                this._setVideoState(false, false);
                break;
            case AudioCodesUA.instance.VIDEO:
                this._setEnabledSendVideo(true);
                this._setEnabledReceiveVideo(true);
                this._setVideoState(true, true);
                break;
            case AudioCodesUA.instance.RECVONLY_VIDEO:
                this._setEnabledSendVideo(false);
                this._setEnabledReceiveVideo(true);
                this._setVideoState(false, true);
                break;
        }

        let options = AudioCodesUA.instance._callOptions(videoOption === AudioCodesUA.instance.VIDEO, false, extraHeaders, extraOptions);
        AudioCodesUA.instance.getWR().getUserMedia(options.mediaConstraints)
            .then((stream) => {
                options.mediaStream = stream;
                this.js_session._localMediaStreamLocallyGenerated = true; // to enable jssip close the stream
                AudioCodesUA.ac_log('AC: answer options:', options);
                this.js_session.answer(options);
            })
            .catch((e) => {
                AudioCodesUA.ac_log('AC: getUserMedia failure', e);
                this.reject(488);
            });
    }

    reject(statusCode = 486, extraHeaders = null) {
        AudioCodesUA.ac_log('AC: reject()');
        try {
            let options = { status_code: statusCode }
            if (extraHeaders) {
                options.extraHeaders = extraHeaders;
            }
            this.js_session.terminate(options);
        } catch (e) {
            AudioCodesUA.ac_log('AC: call reject error:', e);
        }
    }

    terminate() {
        AudioCodesUA.ac_log('AC: terminate()');
        try {
            this.js_session.terminate();
        } catch (e) {
            AudioCodesUA.ac_log('AC: call terminate error:', e);
        }
    }

    redirect(callTo, statusCode = 302, extraHeaders = null) {
        AudioCodesUA.ac_log('AC: redirect() callTo=%s', callTo);
        try {
            let contact = 'Contact: ' + AudioCodesUA.instance.jssipUA.normalizeTarget(callTo);
            let options = {
                status_code: statusCode,
                extraHeaders: [contact]
            };
            if (extraHeaders) {
                options.extraHeaders.push(...extraHeaders);
            }

            this.js_session.terminate(options);
        } catch (e) {
            AudioCodesUA.ac_log('AC: call redirect error:', e);
        }
    }

    isLocalHold() { return this.js_session.isOnHold().local; }
    isRemoteHold() { return this.js_session.isOnHold().remote; }
    isReadyToReOffer() { return this.js_session._isReadyToReOffer(); }

    hold(set) {
        AudioCodesUA.ac_log(`AC: hold(${set})`);
        return new Promise((resolve, reject) => {
            let method = set ? this.js_session.hold : this.js_session.unhold;
            let result = method.call(this.js_session, {}, () => {
                AudioCodesUA.ac_log('AC: hold()/unhold() is completed');
                resolve();
            });

            if (!result) {
                AudioCodesUA.ac_log('AC: hold()/unhold() failed');
                reject();
            }
        });
    }

    /*
     * For audio call. Start sending video
       Get user media with camera stream. Add video. Send re-INVITE with video.
       In re-INVITE can be added extra headers using options.extraHeaders.
       By default set enabled to receive video from other side.
       to disable set options.enabledReceiveVideo = false;
     */
    async startSendingVideo(options = {}) {
        let enabledReceiveVideo = options && options.enabledReceiveVideo !== false; // undefined | true => true
        if (this.hasEnabledSendVideo()) {
            AudioCodesUA.ac_log('AC: startSendingVideo(). Already started');
            throw Error('video already started');
        }
        AudioCodesUA.ac_log('AC: startSendingVideo()');
        let videoStream;
        try {
            videoStream = await AudioCodesUA.instance.getWR().getUserMedia({ video: true });
        } catch (e) {
            AudioCodesUA.ac_log('AC: startSendingVideo() getUserMedia failure', e);
            throw e;
        }

        // to allow JsSIP automatically stop after call termination.
        let videoTrack = videoStream.getVideoTracks()[0];
        let localStream = this.getRTCLocalStream();
        localStream.addTrack(videoTrack);

        this._setEnabledSendVideo(true);
        this._setEnabledReceiveVideo(enabledReceiveVideo);

        let wasUsedSendVideo = this.data['_wasUsedSendVideo'];
        try {
            await AudioCodesUA.instance.getWR().connection.addVideo(this.getRTCPeerConnection(), this.getRTCLocalStream(), videoTrack, this.hasEnabledReceiveVideo(), wasUsedSendVideo);
        } catch (e) {
            AudioCodesUA.ac_log('AC: startSendingVideo(). Adding video error', e);
            throw e;
        }
        await this._renegotiate(options);
    }

    /*
     *  For video call.
     *  Stop sending video. Remove video. Send re-INVITE with inactive video.
     *  Optionally can be used options.extraHeaders
     */
    async stopSendingVideo(options = {}) {
        if (!this.hasEnabledSendVideo()) {
            AudioCodesUA.ac_log('AC: stopSendingVideo(). Already stopped');
            throw Error('video already stopped');
        }
        AudioCodesUA.ac_log('AC: stopSendingVideo()');
        try {
            await AudioCodesUA.instance.getWR().connection.removeVideo(this.getRTCPeerConnection(), this.getRTCLocalStream());
        } catch (e) {
            AudioCodesUA.ac_log('AC: stopSendingVideo(). Remove video error', e);
            throw e;
        }
        this._setEnabledSendVideo(false);
        this.data['_wasUsedSendVideo'] = true;
        await this._renegotiate(options);
    }

    _doRenegotiate(options) {
        return new Promise((resolve, reject) => {
            if (this.js_session.isEnded()) {
                reject();
            }
            if (!this.js_session.renegotiate(options, () => resolve(true))) {
                resolve(false);
            }
        });
    }

    async _renegotiate({ repeat = 30, delay = 500, ...options }) {
        let i = 0;
        while (true) {
            AudioCodesUA.ac_log('AC: Renegotiate' + (i === 0 ? '' : ` try ${i + 1}`));
            if (await this._doRenegotiate(options))
                return;
            i += 1;
            if (i >= repeat) {
                AudioCodesUA.ac_log('AC: Renegotiation failed. Terminated.');
                break;
            }
            AudioCodesUA.ac_log('AC: Renegotiation failed.');
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        throw 'Renegotiation failed. Terminated';
    }

    async sendReInvite(options = {}) {
        AudioCodesUA.ac_log('AC: sendReInvite()');
        await this._renegotiate(options);
        if (options.showStreams) {
            let localStream = this.getRTCLocalStream();
            let remoteStream = this.getRTCRemoteStream();
            AudioCodesUA.ac_log('AC>>: [after send re-INVITE] callShowStreams', this, localStream, remoteStream);
            AudioCodesUA.instance.listeners.callShowStreams(this, localStream, remoteStream);
        }
    }

    // screen sharing.
    async startScreenSharing() {
        AudioCodesUA.ac_log('AC: startScreenSharing');
        if (!AudioCodesUA.instance.getWR().hasDisplayMedia()) {
            AudioCodesUA.ac_log('AC: startScreenSharing: screen sharing is not supported in the browser');
            throw 'Screen sharing is not supported';
        }
        let displayStream, videoTrack;
        try {
            displayStream = await AudioCodesUA.instance.getWR().getDisplayMedia();
            videoTrack = displayStream.getVideoTracks()[0];
        } catch (e) {
            AudioCodesUA.ac_log('AC: startScreenSharing() error', e);
            throw e;
        }
        videoTrack.onended = this._onEndedScreenSharing.bind(this);
        this.data['_screenSharing'] = {
            track: videoTrack,                 // screen sharing video track
            hadSendVideo: this.hasSendVideo()  // if was video before screen sharing
        };

        let wasUsedSendVideo = this.data['_wasUsedSendVideo'];
        let videoAdded;
        try {
            videoAdded = await AudioCodesUA.instance.getWR().connection.addVideo(this.getRTCPeerConnection(), this.getRTCLocalStream(), videoTrack, this.hasEnabledReceiveVideo(), wasUsedSendVideo);
        } catch (e) {
            AudioCodesUA.ac_log('AC: startScreenSharing() error', e);
            this.data['_screenSharing'] = null;
            throw e;
        }
        this._setEnabledSendVideo(true);
        let options = { extraHeaders: ['X-Screen-Sharing: on'] };
        await this._renegotiate(options);
    }

    stopScreenSharing() {
        AudioCodesUA.ac_log('AC: stopScreenSharing');
        let screenSharing = this.data['_screenSharing'];
        if (screenSharing) {
            screenSharing.track.stop();
            screenSharing.track.dispatchEvent(new Event("ended"));
        }
    }

    async _onEndedScreenSharing() {
        AudioCodesUA.ac_log('AC>>: onended screen-sharing video track', this);
        let screenSharing = this.data['_screenSharing'];
        this.data['_screenSharing'] = null;
        if (this.isTerminated())
            return;
        let connection = this.getRTCPeerConnection();
        let localStream = this.getRTCLocalStream();
        let options = { extraHeaders: ['X-Screen-Sharing: off'] };
        if (screenSharing.hadSendVideo) {
            AudioCodesUA.ac_log('AC: screen sharing stopped - restore previously sending video track');
            AudioCodesUA.instance.getWR().connection.replaceSenderTrack(connection, 'video', localStream);
            await this._renegotiate(options);
        } else {
            AudioCodesUA.ac_log('AC: screen sharing stopped - stop send video');
            await this.stopSendingVideo(options);
        }
        if (AudioCodesUA.instance.listeners.callScreenSharingEnded) {
            AudioCodesUA.instance.listeners.callScreenSharingEnded(this);
        }
    }

    /*
     * To restore call "remote hold" state after page reload.
     */
    setRemoteHoldState() {
        this.js_session._remoteHold = true;
    }

    /*
     * Blind or attended transfer
     */
    sendRefer(callTo, probeSession = null) {
        if (!AudioCodesUA.instance.listeners.transferorNotification)
            throw 'transferorNotification missed in phone.setListeners()';

        let ac_session = this;
        let options = {
            eventHandlers: {
                requestSucceeded() {
                    AudioCodesUA.ac_log('AC>>: transferorNotification progress [REFER accepted]');
                    AudioCodesUA.instance.listeners.transferorNotification(ac_session, 0);
                },
                requestFailed() {
                    AudioCodesUA.ac_log('AC>>: transferorNotification failed [REFER failed]');
                    AudioCodesUA.instance.listeners.transferorNotification(ac_session, -1);
                },
                trying() {
                    AudioCodesUA.ac_log('AC>>: transferorNotification progress [NOTIFY 1xx]');
                    AudioCodesUA.instance.listeners.transferorNotification(ac_session, 0);
                },
                progress() {
                    AudioCodesUA.ac_log('AC>>: transferorNotification progress [NOTIFY 1xx]');
                    AudioCodesUA.instance.listeners.transferorNotification(ac_session, 0);
                },
                accepted() {
                    AudioCodesUA.ac_log('AC>>: transferorNotification success [NOTIFY 2xx]');
                    AudioCodesUA.instance.listeners.transferorNotification(ac_session, 1);
                },
                failed() {
                    AudioCodesUA.ac_log('AC>>: transferorNotification failed [NOTIFY >= 300]');
                    AudioCodesUA.instance.listeners.transferorNotification(ac_session, -1);
                }
            }
        };

        // REFER with header ReferTo with replaces parameter
        if (probeSession !== null) {
            options.replaces = probeSession.js_session;
        }

        this.js_session.refer(callTo, options);
    }
}

/*
 * Check SDP
 */
class AudioCodesSDP {
    constructor(sdp) {
        this.start = [];
        this.media = [];
        let lines = sdp.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let current = this.start;
        for (let line of lines) {
            if (line.startsWith('m=')) {
                current = [];
                this.media.push(current);
            }
            current.push(line);
        }
    }
    getMedia(type) {
        for (let m of this.media)
            if (m.length > 0 && m[0].startsWith('m=' + type))
                return m;
        return null;
    }
    checkSendRecv(line) {
        switch (line) {
            case 'a=sendrecv':
                return 'sendrecv';
            case 'a=sendonly':
                return 'sendonly';
            case 'a=recvonly':
                return 'recvonly';
            case 'a=inactive':
                return 'inactive';
            default:
                return null;
        }
    }
    getMediaDirectionValue(type) {
        let media = this.getMedia(type);
        if (media === null)
            return null;

        let t;
        let result = 'sendrecv';
        for (let line of this.start) {
            if ((t = this.checkSendRecv(line)) !== null) {
                result = t;
                break;
            }
        }
        for (let line of media) {
            if ((t = this.checkSendRecv(line)) !== null) {
                result = t;
                break;
            }
        }
        return result;
    }
    getMediaDirection(type, remote) {
        let dir = this.getMediaDirectionValue(type);
        switch (dir) {
            case 'sendrecv':
                return [true, true, dir];
            case 'sendonly':
                return remote ? [false, true, dir] : [true, false, dir];
            case 'recvonly':
                return remote ? [true, false, dir] : [false, true, dir];
            case null:
            case 'inactive':
                return [false, false, dir];
        }
    }
    toString() {
        let result = this.start;
        for (let m of this.media) {
            result = result.concat(m);
        }
        return result.join('\r\n') + '\r\n';
    }
}

// WebRTC Wrapper
let AudioCodesWebRTCWrapper = {
    getUserMedia(constraints) {
        AudioCodesUA.ac_log('[webrtc] getUserMedia constraints', constraints);
        return navigator.mediaDevices.getUserMedia(constraints);
    },

    hasDisplayMedia() {
        return navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia;
    },

    getDisplayMedia() {
        AudioCodesUA.ac_log('[webrtc] getDisplayMedia');
        return navigator.mediaDevices.getDisplayMedia({ video: true });
    },

    // Check WebRTC support. Check presence of microphone and camera
    checkAvailableDevices() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
            return Promise.reject('WebRTC is not supported');
        let cam = false,
            mic = false,
            spkr = false;
        return navigator.mediaDevices.enumerateDevices()
            .then((deviceInfos) => {
                deviceInfos.forEach(function (d) {
                    switch (d.kind) {
                        case 'videoinput':
                            cam = true;
                            break;
                        case 'audioinput':
                            mic = true;
                            break;
                        case 'audiooutput':
                            spkr = true;
                            break;
                    }
                })
                if (navigator.webkitGetUserMedia === undefined) { // Not Chrome
                    spkr = true;
                }
                if (!spkr)
                    return Promise.reject('Missing a speaker! Please connect one and reload');
                if (!mic)
                    return Promise.reject('Missing a microphone! Please connect one and reload');

                return Promise.resolve(cam);
            })
    },

    transceiver:
    {
        setDirection(transceiver, direction) {
            let kind = '';
            if (transceiver.sender.track !== null)
                kind = transceiver.sender.track.kind;
            else if (transceiver.receiver.track !== null)
                kind = transceiver.receiver.track.kind;
            AudioCodesUA.ac_log(`[webrtc] set ${kind} transceiver direction=${direction}`);
            transceiver.direction = direction;
        }
    },

    stream:
    {
        // For logging
        getInfo(stream) {
            function getTrackInfo(tr) { return tr.length > 0 ? tr[0].enabled.toString() : '-'; }
            if (stream === null)
                return Promise.resolve('stream is null');
            return Promise.resolve(`audio: ${getTrackInfo(stream.getAudioTracks())} video: ${getTrackInfo(stream.getVideoTracks())}`)
        },
    },

    connection:
    {
        // For logging
        getTransceiversInfo(connection) {
            function getTransInfo(t) { return t === null ? 'none' : `d=${t.direction} c=${t.currentDirection}`; }
            let ts = connection.getTransceivers();
            let at = AudioCodesUA.instance.getWR().connection.getTransceiver(connection, 'audio');
            let vt = AudioCodesUA.instance.getWR().connection.getTransceiver(connection, 'video');
            return Promise.resolve(`(${ts.length}) audio ${getTransInfo(at)} video ${getTransInfo(vt)}`);
        },

        getTransceiver(connection, kind) {
            for (let t of connection.getTransceivers()) {
                if (t.sender !== null && t.sender.track !== null && t.sender.track.kind === kind) {
                    return t;
                }
                if (t.receiver !== null && t.receiver.track !== null && t.receiver.track.kind === kind) {
                    return t;
                }
            }
            return null;
        },

        addEventListener(connection, eventName, listener) {
            AudioCodesUA.ac_log('[webrtc] Connection addEventListener ' + eventName);
            if (eventName !== 'track')
                return Promise.reject('Wrong event name: ' + eventName);
            connection.addEventListener(eventName, listener);
            return Promise.resolve();
        },

        sendDTMF(connection, tone, duration, interToneGap) {
            AudioCodesUA.ac_log('[webrtc] Connection sendDTMF ' + tone);
            return new Promise((resolve, reject) => {
                try {
                    let audioSender = null;
                    let senders = connection.getSenders();
                    for (let sender of senders) {
                        if (sender.track !== null && sender.track.kind === 'audio') {
                            audioSender = sender;
                            break;
                        }
                    }
                    if (audioSender === null)
                        reject('No audio sender in the connection');
                    audioSender.dtmf.insertDTMF(tone, duration, interToneGap);
                    resolve(true);
                } catch (e) {
                    reject(e);
                }
            });
        },

        async addVideo(connection, localStream, videoTrack, enabledReceiveVideo, wasUsedSendVideo) {
            AudioCodesUA.ac_log('[webrtc] Connection addVideo');
            let vt = AudioCodesUA.instance.getWR().connection.getTransceiver(connection, 'video');
            if (vt !== null) {
                let dir = enabledReceiveVideo ? 'sendrecv' : 'sendonly';
                AudioCodesUA.instance.getWR().transceiver.setDirection(vt, dir);
            }

            if (vt === null || (vt.sender.track === null && !wasUsedSendVideo)) {
                AudioCodesUA.ac_log('[webrtc] addVideo (connection addTrack)');
                connection.addTrack(videoTrack, localStream);
                return true;
            } else {
                AudioCodesUA.ac_log('[webrtc] addVideo (video transceiver sender replaceTrack)');
                await vt.sender.replaceTrack(videoTrack);
                return false;
            }
        },

        async removeVideo(connection, localStream) {
            AudioCodesUA.ac_log('[webrtc] Connection removeVideo');
            let vt = AudioCodesUA.instance.getWR().connection.getTransceiver(connection, 'video');
            if (vt === null)
                throw 'no video transceiver found';
            connection.removeTrack(vt.sender);

            if (localStream) {
                for (let track of localStream.getVideoTracks()) {
                    localStream.removeTrack(track);
                    track.stop();
                }
            }
        },

        replaceSenderTrack(connection, kind, stream) {
            AudioCodesUA.ac_log('[webrtc] ReplaceSenderTrack ' + kind);
            let foundSender = null;
            for (let sender of connection.getSenders()) {
                if (sender.track !== null && sender.track.kind === kind) {
                    foundSender = sender;
                    break;
                }
            }
            if (foundSender === null)
                return Promise.reject(`No ${kind} sender`);
            let tracks = (kind === 'audio') ? stream.getAudioTracks() : stream.getVideoTracks();
            if (tracks.length === 0)
                return Promise.reject(`No ${kind} track`);
            return foundSender.replaceTrack(tracks[0]);
        },

        // "types" example ['outboud-rtp', 'inbound-rtp']
        getStats(connection, types) {
            let str = '';
            return connection.getStats(null)
                .then(report => {
                    report.forEach(now => {
                        if (types.includes(now.type)) {
                            str += ' {';
                            let first = true;
                            for (let key of Object.keys(now)) {
                                if (first) first = false;
                                else str += ',';
                                str += (key + '=' + now[key]);
                            }
                            str += '} \r\n';
                        }
                    });
                    return str;
                })
        }
    }
}