'use strict';
/*
 * The utilities used to build our phone examples.

 * You may consider them an optional part of our SDK.
 * You can use them if they are suitable for your project or replace them with other libraries.
 * For example instead provided in this file AudioPlayer you may use other audio library,
 * instead storageLoadConfig other library to work with local storage, etc.
 *
 *  Load/save configuration from/to local storage
 *  - storageLoadConfig
 *  - storageSaveConfig
 *
 *  IndexedDB
 *  - AbstractDb (abstract indexeddb with single store)
 *  - CallLogDb (call log indexeddb)
 *  - VoiceDb   (recorded voice messages indexeddb)
 *  - MessageDb (received text messages indexeddb)
 *
 *  Audio
 *  - AudioPlayer
 *  - AudioRecorder
 *  - AnsweringMachine
 *
 *  SIP
 *  - AlertInfo parser
 *
 *  Conference
 *  - CallAudioMixer
 *  - CallVideoMixer
 *
 *  Igor Kolosov AudioCodes 2020
 *  Last edit 1-Nov-2020
 */


/**
 * Load JSON object from local storage
 *
 * If object does not exist, will be used default value.
 * If object exists, and has version different from default value version, will be used default value.
 *
 * The version used to override browser local storage value to default value from site.
 *
 * Example:
 *   We upgrade in our site phone from version 1.1 to 1.2.
 *   There are many users of phone version 1.1 in the world and they store some phone configuration
 *   to browser local storage.
 *   In phone version 1.2 the construction of the configuration object is different.
 *   To prevent errors, we should change version of default configuration object in our site,
 *   it forces to load updated version instead using saved in local storage.
 *   (See phone prototype config.js)
 *
 * For debugging can be used storeBack = true,
 * to edit stored value via browser dev. tools.
 */
function storageLoadConfig(name, defValue = null, useLog = true, storeBack = false) {
    let str_value = localStorage.getItem(name);
    let value = null;
    let isLoaded = false;
    let isReplaced = false;
    let isDefault;
    if (str_value) {
        isLoaded = true;
        value = JSON.parse(str_value);
    }
    if (value === null || (defValue !== null && value.version !== defValue.version)) {
        if (isLoaded)
            isReplaced = true;
        isLoaded = false;
        isDefault = true;
        if (defValue !== null)
            value = Object.assign({}, defValue);
    } else {
        isDefault = dataEquals(value, defValue);
    }
    if (useLog) {
        console.log('Used %s %s', value !== null ? (isDefault ? 'default' : 'custom') : 'null', name);
    }
    if (value !== null && (isReplaced || (storeBack && !isLoaded)))
        localStorage.setItem(name, JSON.stringify(value));
    return value;
}

/**
 * Save JSON object to local storage.
 *
 * Default value is optional.
 * If it's provided and object has default value, it will be removed from local storage.
 */
function storageSaveConfig(name, value, defValue = null) {
    if (defValue === null || !dataEquals(value, defValue)) {
        if (defValue !== null && defValue.version && !value.version)
            value.version = defValue.version;
        localStorage.setItem(name, JSON.stringify(value));
    } else {
        localStorage.removeItem(name);
    }
}

// Objects deep equals
function dataEquals(obj1, obj2) {
    if (obj1 === null || obj2 === null) return obj1 === obj2;
    for (let p in obj1) {
        if (obj1.hasOwnProperty(p) !== obj2.hasOwnProperty(p)) return false;
        switch (typeof (obj1[p])) {
            case 'object':
                if (!dataEquals(obj1[p], obj2[p])) return false;
                break;
            case 'function': // No compare functions.
                break;
            default:
                if (obj1[p] != obj2[p]) return false;
        }
    }
    for (let p in obj2) {
        if (typeof (obj1[p]) == 'undefined') return false;
    }
    return true;
}


/**
 * Database with single store and with copy of the store in memory - objects list
 * Purpose: make the list persistent.
 * Key is part of record, based on current time, unique and has name 'id'
 * Number of objects in store is limited, oldest objects will be deleted.
 * If needed, additional stores can be added: override open(),
 * and use get(), put(), clear(), delete() methods with store name.
 */
class AbstractDb {
    constructor(dbName, storeName, maxSize) {
        this.dbName = dbName;
        this.storeName = storeName;
        this.maxSize = maxSize; // max number of objects
        this.db = null;
        this.list = []; // default store copy in memory.
        this.idSeqNumber = -1; // to generate unique key.
    }

    // Create store unique key. (no more than 1 million in the same millisecond)
    // key must be part or record and have name 'id'
    createId(time) {
        this.idSeqNumber = (this.idSeqNumber + 1) % 1000000; // range 0..999999
        return time.toString() + '-' + ('00000' + this.idSeqNumber.toString()).slice(-6);
    }

    // Open the database, if needed create it.
    open() {
        return new Promise((resolve, reject) => {
            let r = indexedDB.open(this.dbName);
            r.onupgradeneeded = (e) => {
                e.target.result.createObjectStore(this.storeName, { keyPath: 'id' });
            }
            r.onsuccess = () => {
                this.db = r.result;
                resolve();
            }
            r.onerror = r.onblocked = () => { reject(r.error); };
        });
    }

    // load records to memory, ordered by time, if needed delete oldest records
    load() {
        return new Promise((resolve, reject) => {
            if (this.db === null) { reject('db is null'); return; }
            let trn = this.db.transaction(this.storeName, 'readwrite');
            trn.onerror = () => { reject(trn.error); }
            let store = trn.objectStore(this.storeName)
            let onsuccess = (list) => {
                this.list = list;
                let nDel = this.list.length - this.maxSize;
                if (nDel <= 0) {
                    resolve();
                } else {
                    let r = store.delete(IDBKeyRange.upperBound(this.list[nDel - 1].id));
                    r.onerror = () => { reject(r.error); }
                    r.onsuccess = () => {
                        this.list = this.list.splice(-this.maxSize);
                        resolve();
                    }
                }
            }
            let onerror = (e) => { reject(e); }
            let getAll = store.getAll ? this._getAllBuiltIn : this._getAllCursor;
            getAll(store, onsuccess, onerror);
        });
    }

    _getAllBuiltIn(store, onsuccess, onerror) { // Chrome, Firefox
        let r = store.getAll();
        r.onerror = () => onerror(r.error);
        r.onsuccess = () => onsuccess(r.result);
    }

    _getAllCursor(store, onsuccess, onerror) { // Legacy Edge
        let list = [];
        let r = store.openCursor();
        r.onerror = () => onerror(r.error);
        r.onsuccess = (e) => {
            let cursor = e.target.result;
            if (cursor) {
                list.push(cursor.value);
                cursor.continue();
            } else {
                onsuccess(list);
            }
        };
    }

    // Add new record. If needed delete oldest records
    add(record) {
        return new Promise((resolve, reject) => {
            if (this.db === null) { reject('db is null'); return; }
            let trn = this.db.transaction(this.storeName, 'readwrite');
            trn.onerror = () => { reject(trn.error); }
            let store = trn.objectStore(this.storeName)
            let r = store.add(record);
            r.onerror = () => { reject(r.error); }
            r.onsuccess = () => {
                this.list.push(record);
                let nDel = this.list.length - this.maxSize;
                if (nDel <= 0) {
                    resolve();
                } else {
                    r = store.delete(IDBKeyRange.upperBound(this.list[nDel - 1].id));
                    r.onerror = () => { reject(r.error); }
                    r.onsuccess = () => {
                        this.list = this.list.splice(-this.maxSize);
                        resolve();
                    }
                }
            }
        });
    }

    // Update record with some unique id.
    update(record) {
        let index = this.list.findIndex((r) => r.id === record.id);
        if (index == -1)
            return Promise.reject('Record is not found');
        this.list[index] = record;
        return this._exec('put', this.storeName, record);
    }

    // Delete record with the key (if store is default delete also from list)
    delete(id, storeName = this.storeName) {
        if (storeName === this.storeName) {
            let index = this.list.findIndex((r) => r.id === id);
            if (index == -1)
                return Promise.reject('Record is not found');
            this.list.splice(index, 1);
        }
        return this._exec('delete', storeName, id);
    }

    // Clear all store records
    clear(storeName = this.storeName) {
        this.list = [];
        return this._exec('clear', storeName);
    }

    get(key, storeName) {
        return this._exec('get', storeName, key);
    }

    put(record, storeName) {
        return this._exec('put', storeName, record);
    }

    // Single transaction operation.
    _exec(op, storeName, data) {
        return new Promise((resolve, reject) => {
            if (this.db === null) { reject('db is null'); return; }
            let trn = this.db.transaction(storeName, 'readwrite');
            trn.onerror = () => { reject(trn.error); }
            let store = trn.objectStore(storeName)
            let r;
            switch (op) {
                case 'clear':
                    r = store.clear();
                    break;
                case 'delete':
                    r = store.delete(data);
                    break;
                case 'put':
                    r = store.put(data);
                    break;
                case 'get':
                    r = store.get(data);
                    break;
                default:
                    reject('db: wrong request');
                    return;
            }
            r.onerror = () => { reject(r.error); }
            r.onsuccess = () => { resolve(r.result); }
        });
    }
}


/**
 * To keep phone call logs.
 */
class CallLogDb extends AbstractDb {
    constructor(maxSize) {
        super('phone', 'call_log', maxSize);
    }
}

/*
 *  To use with automatic answer machine. Created 2 stores:
 *  'records' default store, to save last (up to maxSize) answer records.
 *  'greeting' additional store, to save custom greeting.
 */
class VoiceDb extends AbstractDb {
    constructor(maxSize) {
        super('voice_db', 'records', maxSize);
    }

    open() {
        return new Promise((resolve, reject) => {
            let r = indexedDB.open(this.dbName);
            r.onupgradeneeded = (e) => {
                e.target.result.createObjectStore(this.storeName, { keyPath: 'id' });
                e.target.result.createObjectStore('greeting', { keyPath: 'id' });
            }
            r.onsuccess = () => {
                this.db = r.result;
                resolve();
            }
            r.onerror = r.onblocked = () => { reject(r.error); };
        });
    }
}

/**
 * To keep incoming text messages.
 */
class MessageDb extends AbstractDb {
    constructor(maxSize) {
        super('message_db', 'messages', maxSize);
    }
}

/*
 * Download & decode sound from site
 * Generate sound by pattern (ring-tone, busy-tone, special, DTMF, ...)
 * Play sound to speaker or to stream
 *
 * For modern browsers only and for secure connection.
 * Used AudioContext API.
 * Can be used in Chrome, Firefox, Safari, iOS Safari
 */
class AudioPlayer {
    constructor(createCtx = true) {
        this.logger = console.log; // by default.
        this.audioCtx = null;
        this.sounds = {};
        this.source = null;
        this.resolve = null;
        this.gain = null;
        this.streamDestination = null;
        this.dtmfTones = {
            '1': [{ f: [697, 1209], t: 0.2 }],
            '2': [{ f: [697, 1336], t: 0.2 }],
            '3': [{ f: [697, 1477], t: 0.2 }],
            '4': [{ f: [770, 1209], t: 0.2 }],
            '5': [{ f: [770, 1336], t: 0.2 }],
            '6': [{ f: [770, 1477], t: 0.2 }],
            '7': [{ f: [852, 1209], t: 0.2 }],
            '8': [{ f: [852, 1336], t: 0.2 }],
            '9': [{ f: [852, 1477], t: 0.2 }],
            '*': [{ f: [941, 1209], t: 0.2 }],
            '0': [{ f: [941, 1336], t: 0.2 }],
            '#': [{ f: [941, 1477], t: 0.2 }],
			'A': [{ f: [697, 1633], t: 0.2 }],
			'B': [{ f: [770, 1633], t: 0.2 }],
			'C': [{ f: [852, 1633], t: 0.2 }],
			'D': [{ f: [941, 1633], t: 0.2 }]
        };

        this.browser = this._browser();
        this.encodings = {
            chrome: ['mp3', 'aac', 'ogg'],
            firefox: ['mp3', 'aac', 'ogg'],
            safari: ['mp3', 'aac'],
            ios_safari: ['mp3', 'aac'],
            other: ['mp3', 'aac', 'ogg']
        }[this.browser];

        if (createCtx) {
            this.createCtx();
            if (this.isDisabled()) {
                console.log('AudioPlayer: AudioContext is suspended [Autoplay Policy]');
            }
        }
    }

    _browser() {
        if (/iPad|iPhone|iPod/.test(navigator.userAgent))
            return 'ios_safari'; 
        if (navigator.mozGetUserMedia)
            return 'firefox';
        if (navigator.webkitGetUserMedia) // Work only for secure connection
            return 'chrome';
        if (window.safari)
            return 'safari';
        return 'other';
    }

    createCtx() {
        try {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            this.logger('AudioPlayer: cannot create audioContext', e);
        }
    }

    init(logger, audioCtx = undefined) {
        this.logger = logger;
        this.logger(`AudioPlayer: init  (${this.browser})`);
        if (audioCtx !== undefined)
            this.audioCtx = audioCtx;

        if (this.browser === 'safari' || this.browser === 'ios_safari')
            this._setDecodeAudioDataShim(this.audioCtx);
    }

    // for Safari
    _setDecodeAudioDataShim(audioCtx) {
        let origDecodeAudioData = audioCtx.decodeAudioData;
        audioCtx.decodeAudioData = (data) => new Promise((resolve, reject) => {
            origDecodeAudioData.call(audioCtx, data, (d) => resolve(d), (e) => reject(e))
        });
    }

    // for Safari
    _setStartRenderingShim(offlineCtx) {
        let origStartRendering = offlineCtx.startRendering;
        offlineCtx.startRendering = () => new Promise((resolve) => {
            offlineCtx.oncomplete = (e) => { resolve(e.renderedBuffer); }
            origStartRendering.call(offlineCtx);
        });
    }

    // Check if context is disabled by audio auto-play policy.
    // Chrome implementation of audio auto-play policy is not compatible with Firefox,
    // where audio context after creation is also suspended during short time.
    isDisabled() {
        switch (this.browser) {
            case 'chrome':
            case 'safari':
            case 'ios_safari':
                return this.isSuspended();
            default:
                return false;
        }
    }

    enable() {
        switch (this.browser) {
            case 'chrome':
            case 'safari':
            case 'ios_safari':
                return this.resume();
            default:
                return Promise.resolve();
        }
    }

    isSuspended() {
        return this.audioCtx.state === 'suspended';
    }

    resume() {
        return this.audioCtx.resume();
    }

    suspend() {
        return this.audioCtx.suspend();
    }

    /**
     * Play sound
     * @param options
     *   name  sound clip name (must be set)
     *
     *   volume = 0..1.0   (1.0 by default)
     *
     *   Loop options:
     *     loop = true/false (false by default) Endless loop
     *     repeat =  repeat N times (undefined by default) Set automatically loop=true
     *
     *     duration seconds (undefined by default) Can be used with or without loop=true
     *
     *   If we want use part of downloaded sound, can be used:
     *
     *   clipStart (undefined by default)
     *   clipEnd  (undefined by default)
     *
     *   streamDestination (undefined by default), value mediaStreamDestination.
     *   Assign output to audio stream (dest.stream) instead of speaker.
     *
     *   startDelay  (0 by default).
     *   Before start delay some time.
     *
     * dropDisabled returns immediately when audioContext is suspended.
     * @returns Promise to check when playing is finished.
     */
    play(options) {
        if (!this.audioCtx)
            return Promise.reject('No audio context');

        if (this.isDisabled() && options.dropDisabled) { // To prevent sound defect after enabling.
            return Promise.resolve('drop sound for disabled');
        }

        return new Promise((resolve, reject) => {
            this.stop();
            this.resolve = resolve;
            try {
                let buf = this.sounds[options.name];
                if (!buf) {
                    this.logger('AudioPlayer: no sound: ' + options.name);
                    reject('No sound');
                    return;
                }
                this.logger('AudioPlayer: play:', options);
                this.source = this.audioCtx.createBufferSource();
                this.source.buffer = buf;

                this.source.onended = (e) => {
                    this.logger('AudioPlayer: onended ' + options.name);
                    resolve(true);
                }
                this.source.onerror = (e) => {
                    this.logger('AudioPlayer: onerror callback', e);
                    this._releaseResources();
                    reject('onerror callback');
                }

                this.gain = this.audioCtx.createGain();
                let volume = options.volume ? options.volume : 1.0;
                this.gain.gain.setValueAtTime(volume, this.audioCtx.currentTime);
                this.source.connect(this.gain);
                if (options.streamDestination) {
                    this.streamDestination = options.streamDestination;
                    this.gain.connect(this.streamDestination);
                } else {
                    this.streamDestination = null;
                    this.gain.connect(this.audioCtx.destination);
                }

                let clipStart = options.clipStart ? options.clipStart : 0;
                let clipEnd = options.clipEnd ? options.clipEnd : null;
                if (options.loop === true || options.repeat) {
                    this.source.loop = true;
                    this.source.loopStart = clipStart;
                    if (clipEnd)
                        this.source.loopEnd = clipEnd;
                }

                let duration = null;
                if (options.duration) {
                    duration = options.duration;
                } else if (options.repeat) {
                    if (clipEnd === null) clipEnd = this.source.buffer.duration;
                    duration = (clipEnd - clipStart) * options.repeat;
                } else if (clipEnd !== null) {
                    duration = clipEnd - clipStart;
                }

                let startDelay = 0;
                if (options.startDelay) {
                    startDelay = this.audioCtx.currentTime + options.startDelay;
                    if (duration)
                        duration += options.startDelay;
                }
                this.source.start(startDelay, clipStart);
                if (duration)
                    this.source.stop(this.audioCtx.currentTime + duration);
            } catch (e) {
                this.logger('AudioPlayer: play error', e);
                reject(e);
            }
        });
    }

    _releaseResources() {
        if (this.source)
            this.logger('AudioPlayer: release resources');

        try {
            this.source && this.source.stop();
        } catch (e) {
        }

        try {
            this.gain && this.gain.disconnect();
            this.source && this.source.disconnect();
            this.streamDestination && this.streamDestination.disconnect();
            this.gain = null;
            this.source = null;
            this.streamDestination = null;
        } catch (e) {
            this.logger('AudioPlayer: release resources error', e);
        }
    }

    /**
     * Stop playing (if was)
     */
    stop() {
        this._releaseResources();
        // Chrome bug workaround: source.stop does not lead to a call "onended"
        if (this.resolve) {
            this.resolve('stopped externally');
            this.resolve = null;
        }
    }

    /*
        Download set of sounds & decoding

        The same sound should be saved in site in different encodings: mp3, ogg, acc.

        For each browser set preferred encoding sequence:
        for Chrome, Firefox used ['mp3', 'acc', 'ogg'],
        for Safari used ['mp3', 'acc']
        At the first the function try to download and decode mp3 format,
        if there no such file or encoding error occured, will be used next encoding from the list.

        For modern browsers, it is enough to use MP3 sound encoding,
        without backup encoding formats.
        Usage example: download('sounds/', ['ring', 'bell'])
                       download('sounds/', [{ring: 'ring2'}, 'bell'])

        The download of sound stop after successull decoding, to check all encodings formats
        in some browser let use test=true
    */
    async downloadSounds(path, soundList, encodings = this.encodings, test = false) {
        this.logger('AudioPlayer: downloadSounds', soundList);
        for (let sound of soundList) {
            await this.downloadSound(path, sound, encodings, test);
        }
    }

    /*
       Download & decode sound. 
       Mostly used mp3 encoding, may be used also aac and ogg.
       Argument sound define sound file and corresponding sound name.
       Defined as string, if used the same name for file and sound.
          E.g. 'ring' Download file ring.mp3 and save as sound 'ring'
       Defined as object, if used diffrent names for file and sound.
          E.g. {ring: 'ring2'} Download file ring2.mp3 and save as sound 'ring'
     */
    async downloadSound(path, sound, encodings = this.encodings, test = false) {
        let decodedData = null;
        let soundName, fileName;
        if (sound instanceof Object) {
            soundName = Object.keys(sound)[0];
            fileName = sound[soundName];
        } else {
            soundName = fileName = sound;
        }
        for (let ext of encodings) {
            let file = fileName + '.' + ext;
            let data = null;
            let downloadStart = Date.now();
            try {
                let response = await fetch(path + file, { credentials: 'same-origin' });
                data = await response.arrayBuffer();
            } catch (e) {
                continue;
            }

            let decodingStart = Date.now();
            try {
                decodedData = await this.audioCtx.decodeAudioData(data);
                if (!test)
                    break;
                let decodingEnd = Date.now();
                this.logger('AudioPlayer [test] ' + file + ' is downloaded (%s) and decoded (%s)',
                    ((decodingStart - downloadStart) / 1000).toFixed(3), ((decodingEnd - decodingStart) / 1000).toFixed(3));
            } catch (e) {
                this.logger('AudioPlayer: decoding error: ' + fileName, e);
                continue;
            }
        }
        if (decodedData !== null) {
            this.sounds[soundName] = decodedData;
        } else {
            this.logger('AudioPlayer: Cannot download & decode: ' + fileName);
        }
        return decodedData;
    }

    /*  Phone ringing, busy and other tones vary in different countries, see:
     *  https://www.itu.int/ITU-T/inr/forms/files/tones-0203.pdf
     *
     *  Most can be easily generated, other can be downloaded as recorded sound.
     *
     *  France:
     *           Ringing tone - 440 1.5 on 3.5 off
     *           Busy tone - 440 0.5 on 0.5 off
     *
     *  Germany:
     *           Ringing tone - 425 1.0 on 4.0 off
     *           Busy tone - 425 0.48 on 0.48 off
     *           Special information tone - 900/1400/1800 3x0.33 on 1.0 off
     *
     *  Great Britain
     *          Ringing tone - 400+450  0.4 on 0.2 off 0.4 on 2.0 off  (simplified)
     *          Busy tone -  400 0.375 on 0.375 off
     *
     *  toneDefinition argument describe tone generation, as sequence of steps:
     *  here f - frequency, t - time.
     *
     *  Germany ringing [{f:425, t:1.0},  {t:4.0}]
     *  Germany busy    [{f:425, t:0.48}, {t:0.48}]
     *  Germany special [{f:900, t:0.33}, {f:1400, t:0.33}, {f:1800, t:0.33}, {t:1.0}]
     *  DTMF for '#'    [{f:[941, 1477], 0.2}]
     *  Great Britain ringing [{f:[400,450], t:0.4}, {t:0.2}, {f:[400, 450], t:0.4}, {t:2.0}]
     */
    generateTone(toneName, toneDefinition) {
        function getArray(e) {
            if (e === undefined) return [];
            if (Array.isArray(e)) return e;
            return [e];
        }

        try {
            let duration = 0;
            let oscillatorNumber = 0;
            for (let step of toneDefinition) {
                duration += step.t;
                oscillatorNumber = Math.max(oscillatorNumber, getArray(step.f).length);
            }
            let channels = 1;
            let sampleRate = this.audioCtx.sampleRate;
            let frameCount = sampleRate * duration;
            let offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(channels, frameCount, sampleRate);
            if (this.browser === 'safari' || this.browser === 'ios_safari')
                this._setStartRenderingShim(offlineCtx);

            let oscillators = new Array(oscillatorNumber);
            for (let i = 0; i < oscillators.length; i++) {
                oscillators[i] = offlineCtx.createOscillator();
                oscillators[i].connect(offlineCtx.destination);
            }

            let time = 0;
            for (let i = 0, num = toneDefinition.length; i < num; i++) {
                let step = toneDefinition[i];
                let frequencies = getArray(step.f);
                for (let j = 0; j < oscillators.length; j++) {
                    let f = (j < frequencies.length) ? frequencies[j] : 0;
                    oscillators[j].frequency.setValueAtTime(f, offlineCtx.currentTime + time);
                }
                time += step.t;
            }

            for (let o of oscillators) {
                o.start(0);
                o.stop(offlineCtx.currentTime + duration);
            }

            return offlineCtx.startRendering()
                .then(renderedBuffer => {
                    for (let o of oscillators)
                        o.disconnect();
                    this.sounds[toneName] = renderedBuffer;
                });
        } catch (e) {
            this.logger('AudioPlayer: cannot generate tone', e);
            return Promise.reject(e);
        }
    }

    async generateTonesSuite(suite) {
        for (const tone in suite) {
            await this.generateTone(tone, suite[tone]);
        }
    }

    generateTones(ringingTone, busyTone) {
        return this.generateTonesSuite(Object.assign({ 'ringingTone': ringingTone, 'busyTone': busyTone }, this.dtmfSuite));
    }
}

/*
 * Recording API.
 * For modern browsers only. Used MediaRecorder API.
 * Can be used in Chrome and Firefox.
 * Not implemented in Safari
 */
class AudioRecorder {
    constructor() {
        this.logger = null;
        this.audioCtx = null;
        this.chunks = [];
        this.recorder = null;
        this.browser = this._browser();
        this.options = {
            'chrome': { mimeType: 'audio/webm;codec=opus' },
            'firefox': { mimeType: 'audio/ogg;codec=opus' },
            'safari': undefined,
            'ios_safari': undefined,
            'other': undefined
        }[this.browser];
    }

    _browser() {
        if (/iPad|iPhone|iPod/.test(navigator.userAgent))
            return 'ios_safari';
        if (navigator.mozGetUserMedia)
            return 'firefox';
        if (navigator.webkitGetUserMedia) // Work only for secure connection
            return 'chrome';
        if (window.safari)
            return 'safari';
        return 'other';
    }

    init(logger, audioCtx) {
        this.logger = logger;
        this.audioCtx = audioCtx;
    }

    isRecording() {
        return this.recorder && this.recorder.state === 'recording';
    }

    recordStream(stream) {
        this.logger('AudioRecorder: recordStream()');
        this.create(stream);
        return this.start()
            .then(blob => {
                let tracks = this.recorder.stream.getTracks();
                for (let track of tracks)
                    track.stop();
                return blob;
            });
    }

    static canBeUsed() {
        return typeof MediaRecorder === 'function';
    }

    create(stream) {
        let audioStream = new MediaStream(stream.getAudioTracks());
        this.recorder = new MediaRecorder(audioStream, this.options);
    }

    start() {
        return new Promise((resolve, reject) => {
            this.chunks = [];
            this.recorder.ondataavailable = (e) => {
                this.chunks.push(e.data);
            };
            this.recorder.onerror = (e) => {
                reject(e);
            }
            this.recorder.onstop = () => {
                resolve(new Blob(this.chunks, { type: 'audio/ogg;codecs=opus' }));
                this.chunks = [];
            };
            this.recorder.start();
        });
    }

    stop() {
        if (!this.recorder || this.recorder.state !== 'recording')
            return;
        this.logger('AudioRecorder: stop');
        this.recorder.stop();
    }

    decodeSoundBlob(blob) {
        return fetch(URL.createObjectURL(blob))
            .then(response => {
                return response.arrayBuffer();
            })
            .then(buffer => {
                return this.audioCtx.decodeAudioData(buffer);
            })
    }
}

/**
 * Automatic answering machine.
 * Play greeting, record answer.
 */
class AnsweringMachine {
    constructor() {
        this.use = true;
        this.startDelay = 16;
        this.recordDuration = 20;
        this.run = false;
        this.logger = null;
        this.call = null;
        this.streamDest = null;
        this.answerTimer = null;
        this.recordingTimer = null;
    }

    init(audioPlayer, audioRecorder) {
        this.audioPlayer = audioPlayer;
        this.logger = audioPlayer.logger;
        this.audioRecorder = audioRecorder;
    }

    startTimer(call, answerCallback) {
        this.call = call;
        this.stopTimer();
        this.answerTimer = setTimeout(() => {
            this.run = true;
            answerCallback();
        }, this.startDelay * 1000);
    }

    stopTimer() {
        if (this.answerTimer !== null) {
            clearTimeout(this.answerTimer);
            this.answerTimer = null;
        }
    }

    createPlayerStream() {
        this.streamDest = this.audioPlayer.audioCtx.createMediaStreamDestination();
        return this.streamDest.stream;
    }

    // Called if a call is terminated.
    stop(call) {
        if (call === this.call) {
            this.stopTimer();
            this.audioRecorder.stop();
            if (this.recordingTimer !== null) {
                clearTimeout(this.recordingTimer);
                this.recordingTimer = null;
            }
            this.run = false;
        }
    }

    // Use destination stream, instead speaker.
    playGreeting() {
        return this.audioPlayer.play({
            name: 'greeting',
            streamDestination: this.streamDest,
            volume: 1.0,
            startDelay: 1.6
        })
            .then(() => {
                return this.audioPlayer.play({
                    name: 'beep',
                    volume: 0.2,
                    streamDestination: this.streamDest,
                });
            })
    }

    // Record remote stream of the call.
    recordAnswer(remoteStream) {
        this.audioRecorder.create(remoteStream);

        this.recordingTimer = setTimeout(() => {
            this.logger('AnsweringMachine: maximum recording time reached.');
            this.audioRecorder.stop();
        }, this.recordDuration * 1000);

        return this.audioRecorder.start()
            .then(blob => {
                this.run = false;
                return blob;
            });
    }
}

/**
 *  SIP Alert-Info header parser.
 *
 * Alert-Info   =  "Alert-Info" HCOLON alert-param *(COMMA alert-param)
 * alert-param  =  LAQUOT absoluteURI RAQUOT *( SEMI generic-param )
 */
class AlertInfo {
    constructor(incomingMsg) {
        this.parsed = [];
        try {
            for (let hh of incomingMsg.getHeaders('alert-info')) {
                for (let h of hh.split(',')) {
                    this._parseHeader(h);
                }
            }
        } catch (e) {
            console.log('Alert-Info parsing error', e);
        }
    }

    _parseHeader(h) {
        let st = h.split(';');
        let url;
        if (st[0].startsWith('<') && st[0].endsWith('>'))
            url = st[0].slice(1, -1);
        else
            return;
        let params = new Map();
        for (let pr of st.slice(1)) {
            let eq = pr.indexOf('=');
            if (eq !== -1) {
                let k = pr.substring(0, eq);
                let v = pr.substring(eq + 1);
                if (v.startsWith('"') && v.endsWith('"'))
                    v = v.slice(1, -1);
                params.set(k.toLowerCase(), v.toLowerCase());
            }
        }
        this.parsed.push({ url: url, params: params });
    }

    exists() {
        return this.parsed.length > 0;
    }

    param(key, ix = 0) {
        if (ix >= this.parsed.length)
            return null;
        return this.parsed[ix].params.get(key)
    }

    url(ix = 0) {
        return this.parsed[ix].url;
    }

    getDelay(ix = 0) {
        let delay = this.param('delay', ix);
        if (!delay)
            return -1;
        return parseInt(delay);
    }

    hasAutoAnswer(ix = 0) {
        return this.param('info', ix) === 'alert-autoanswer';
    }
}

/**
 *  Audio mixer (for audio conference)
 */
class CallAudioMixer {
    // For each call created audio mixer instance.
    // Аudio context can be taken from audio player
    constructor(audioCtx, call) {
        this.audioCtx = audioCtx;
        this.dest = this.audioCtx.createMediaStreamDestination();
        this.calls = [];
        let source = this.audioCtx.createMediaStreamSource(call.getRTCLocalStream());
        source.connect(this.dest);
        this.calls.push({ call, source });
    }

    // Close mixer, release all resources.
    close() {
        if (this.dest !== null) {
            this.dest.disconnect();
            this.dest = null;
        }
        for (let c of this.calls) {
            c.source.disconnect();
        }
        this.calls = [];
    }

    // Get mixed audio stream
    getMix() { return this.dest.stream; }

    // Add call to mixer.
    // Returns true if added, false if the call is already added.
    add(call) {
        let ix = this.calls.findIndex(c => c.call === call);
        if (ix !== -1)
            return false;
        let stream = call.getRTCRemoteStream();
        let source = this.audioCtx.createMediaStreamSource(stream);
        source.connect(this.dest);
        this.calls.push({ call, source });
        return true;
    }

    // Remove call from mixer
    // Returns true if removed.
    // Returns false, if the call was not added, or cannot be removed, because set in constructor.
    remove(call) {
        let ix = this.calls.findIndex(c => c.call === call);
        if (ix === -1 || ix === 0)
            return false;
        this.calls[ix].source.disconnect();
        this.calls.splice(ix, 1);
        return true;
    }

    // Returns string with calls list
    toString() { return 'audio mixer ' + this.calls.map((c) => c.call.data['_line_index'] + 1); }
}

/**
 *  Video mixer (for video conference)
 */
class CallVideoMixer {
    // Used single instance for all calls.
    constructor() {
        this.layout = 'compact';
        this.run = false;
        this.calls = [];
        this.localVideo = null;
        this.canvas = null;
        this.canvasCtx = null;
        this.canvasBackground = "#F5F5F5"; // light smoke
        this.width = 160;
        this.height = 120;
        this.nVideo = 0;
        this.drawInterval = 100;
        this.remoteVideoId = '';
        this.frame = 1;
        this.data = {};
    }

    // Set canvas id.
    // Set local video element id.
    // Set remote video element id prefix. (will be added video element index 0, 1, ...)
    setElements(canvasId, localVideoId, remoteVideoId) {
        this.canvas = document.getElementById(canvasId);
        this.canvasCtx = this.canvas.getContext('2d');
        this.localVideo = document.getElementById(localVideoId);;
        this.remoteVideoId = remoteVideoId;
    }

    // Set number of frames per seconds of mixed stream.
    // For example: 1, 2, 5, 10, 20, 50.
    // Default: 10
    setFPS(v) { this.setDrawInterval(1000 / v); }

    // Set interval between draw (milliseconds)
    // Default: 100
    // It can be set also via setFPS
    setDrawInterval(v) { this.drawInterval = v; }

    // Set calls video layout: 'linear' or 'compact'
    // Default: 'compact'
    setLayout(v) {
        switch (v) {
            case 'linear':
            case 'compact':
                this.layout = v;
                break;
            default:
                throw 'Unknown layout: ' + v;
        }
        this.resize();
    }

    // Set call video size (pixels)
    // Default w=160, h=120
    setSize(w, h) {
        this.width = w;
        this.height = h;
        this.resize();
    }

    // Set call video sizes (pixels)
    // size likes: {width: '160px', height: '120px'}
    setSizes(size) { // format {width: '160px', height: '120px'}
        let w = parseInt(size.width.slice(0, -2));
        let h = parseInt(size.height.slice(0, -2));
        this.setSize(w, h);
    }

    // Returns true when mixer is started
    isOn() { return this.run; }

    // Start mixer
    start() {
        if (this.run)
            return;
        setTimeout(this._draw.bind(this), this.drawInterval);
        this.run = true;
    }

    // Stop mixer, remove all calls, release resources.
    // After using stop the mixer can be restarted.
    stop() {
        while (this.calls.length > 0)
            this.remove(this.calls[0].call);
        this.run = false;
    }

    // Get mixed video stream for added call.
    getMix(call) {
        let ix = this.calls.findIndex(d => d.call === call);
        return (ix !== -1) ? this.calls[ix].mix : null;
    }

    // Add call to mixer or update send/receive mode.
    // Returns true if send video was added (should be replaced connection sender track)
    add(call, send = true, receive = true) {
        let ix = this.calls.findIndex(d => d.call === call);
        if (ix === -1) {
            return this._add(call, send, receive);
        } else {
            return this._update(ix, send, receive);
        }
    }

    _add(call, send, receive) {
        let mix = send ? this.canvas.captureStream() : null;
        let elt = receive ? document.getElementById(this.remoteVideoId + call.data['_line_index']) : null;
        let x = 0;
        let y = 0;
        this.calls.push({ call, elt, mix, x, y });
        if (elt !== null)
            this.resize();
        return mix !== null;
    }

    _update(ix, send, receive) {
        let d = this.calls[ix];
        let sendModified = false;
        if (send) {
            if (d.mix === null) {
                d.mix = this.canvas.captureStream();
                sendModified = true;
            }
        } else {
            if (d.mix !== null) {
                for (let track of d.mix.getVideoTracks())
                    track.stop();
                d.mix = null;
                sendModified = true;
            }
        }
        if (receive) {
            if (d.elt === null) {
                d.elt = document.getElementById(this.remoteVideoId + d.call.data['_line_index']);
                this.resize();
            }
        } else {
            if (d.elt !== null) {
                d.elt = null;
                this.resize();
            }
        }
        return sendModified;
    }

    // Remove call from mixer.
    // Returns true if removed, false if was not added.
    remove(call) {
        let ix = this.calls.findIndex(d => d.call === call);
        //console.log('video mixer: remove call with index=', call.data['_line_index'], ix);
        if (ix === -1)
            return false;
        let d = this.calls[ix];
        if (d.mix !== null) {
            for (let track of d.mix.getVideoTracks())
                track.stop();
        }
        this.calls.splice(ix, 1);
        if (d.elt !== null)
            this.resize();
        return true;
    }

    // number of video displayed in canvas
    _nVideo() {
        let n = 0;
        if (this.localVideo.srcObject !== null)
            n++;
        for (let d of this.calls)
            if (d.elt !== null)
                n++;
        return n;
    }

    // Resize video layout then changed number of video channels
    // Used when added/removed local video channel.
    // Called automatically in methods: add, remove, setLayout, setSize
    //
    // Warning: it's designed for 5 lines phone !
    // Max number of video controls is 6 (including local video)
    // If you use more lines, please modify this method.
    //
    // Video layouts
    // linear   0 1     0 1 2     0 1 2 3    0 1 2 3 4 ....
    //
    // compact  0 1     0 1      0 1      0 1 2     0 1 2
    //                   2       2 3       3 4      3 4 5
    resize() {
        this.nVideo = this._nVideo(); // number of shown video
        //console.log(`videoMixer: resize nVideo=${this.nVideo} [${this.localVideo.srcObject !== null ? 'with local':'without local'} video]`);
        switch (this.layout) {
            case 'linear':
                this.canvas.width = (this.width + this.frame) * this.nVideo;
                this.canvas.height = this.height;
                break;
            case 'compact':
                if (this.nVideo <= 2) {
                    this.canvas.width = (this.width + this.frame) * this.nVideo;
                    this.canvas.height = this.height;
                } else if (this.nVideo <= 4) {
                    this.canvas.width = (this.width + this.frame) * 2;
                    this.canvas.height = this.height * 2 + this.frame;
                } else {
                    this.canvas.width = this.width * 3;
                    this.canvas.height = this.height * 2 + this.frame;
                }
                break;
        }

        this.canvasCtx.fillStyle = this.canvasBackground;
        this.canvasCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // sort calls by line index
        this.calls.sort((d1, d2) => d1.call.data['_line_index'] - d2.call.data['_line_index']);

        // reorder pictures in canvas
        let ix = 0;
        if (this.localVideo.srcObject !== null)
            ix++;
        for (let d of this.calls) {
            if (d.elt !== null) {
                let [x, y] = this._location(ix);
                d.x = x;
                d.y = y;
                ix++;
            }
        }
    }

    // Calculate video picture location by index.
    //
    // Warning: it's designed for 5 lines phone !
    // Max number of video controls is 6 (including local video)
    // If you use more lines, modify this method
    _location(ix) {
        let w = this.width + this.frame;
        let h = this.height + this.frame;
        switch (this.layout) {
            case 'linear':
                return [ix * w, 0];
            case 'compact':
                switch (this.nVideo) {
                    case 0:
                    case 1:
                    case 2:
                        return [ix * w, 0];
                    case 3:
                        return (ix < 2) ? [w, 0] : [w * (ix - 2) + 0.5 * w, h];
                    case 4:
                        return (ix < 2) ? [w, 0] : [w * (ix - 2), h];
                    case 5:
                        return (ix < 3) ? [w * ix, 0] : [w * (ix - 3) + 0.5 * w, h];
                    case 6:
                        return (ix < 3) ? [w * ix, 0] : [w * (ix - 3), h];
                }
        }
    }

    _draw() {
        if (!this.run)
            return;
        try {
            if (this.nVideo > 0) {
                if (this.localVideo.srcObject !== null)
                    this.canvasCtx.drawImage(this.localVideo, 0, 0, this.width, this.height);
                for (let d of this.calls) {
                    if (d.elt !== null)
                        this.canvasCtx.drawImage(d.elt, d.x, d.y, this.width, this.height);
                }
            }
        } catch (e) {
            console.log(e);
        }
        setTimeout(this._draw.bind(this), this.drawInterval);
    }

    // Returns string with calls list
    toString() {
        if (this.run) {
            return 'video mixer ' + this.calls.map((c) => `${c.call.data['_line_index'] + 1}${c.mix !== null ? 's' : ''}${c.elt !== null ? 'r' : ''}`);
        } else {
            return 'video mixer is off';
        }
    }
}