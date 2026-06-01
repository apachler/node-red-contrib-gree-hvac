'use strict';

const crypto = require('crypto');

const ECB_GENERIC_KEY = 'a3K8Bx%2r8Y7#xDh';
const GCM_GENERIC_KEY = '{yxAHAY_Lm6pbC/<';
const GCM_NONCE = Buffer.from('5440784449675a516c5e6313', 'hex');
const GCM_AEAD = Buffer.from('qualcomm-test');

class EcbCipher {
    constructor(key = ECB_GENERIC_KEY) {
        this._key = key;
    }
    setKey(key) {
        this._key = key;
    }
    getKey() {
        return this._key;
    }
    decrypt(packB64) {
        const decipher = crypto.createDecipheriv('aes-128-ecb', this._key, '');
        const str = decipher.update(packB64, 'base64', 'utf8');
        return JSON.parse(str + decipher.final('utf8'));
    }
    encrypt(obj) {
        const cipher = crypto.createCipheriv('aes-128-ecb', this._key, '');
        const str = cipher.update(JSON.stringify(obj), 'utf8', 'base64');
        return { pack: str + cipher.final('base64') };
    }
}

class GcmCipher {
    constructor(key = GCM_GENERIC_KEY) {
        this._key = key;
    }
    setKey(key) {
        this._key = key;
    }
    getKey() {
        return this._key;
    }
    decrypt(packB64, tagB64) {
        const decipher = crypto.createDecipheriv(
            'aes-128-gcm',
            this._key,
            GCM_NONCE
        );
        decipher.setAAD(GCM_AEAD);
        if (tagB64) {
            decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        }
        const str = decipher.update(packB64, 'base64', 'utf8');
        return JSON.parse(str + decipher.final('utf8'));
    }
    encrypt(obj) {
        const cipher = crypto.createCipheriv(
            'aes-128-gcm',
            this._key,
            GCM_NONCE
        );
        cipher.setAAD(GCM_AEAD);
        const str = cipher.update(JSON.stringify(obj), 'utf8', 'base64');
        const pack = str + cipher.final('base64');
        const tag = cipher.getAuthTag().toString('base64');
        return { pack, tag };
    }
}

function randomDeviceKey() {
    const alphabet =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 16; i++) {
        out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return out;
}

module.exports = {
    EcbCipher,
    GcmCipher,
    randomDeviceKey,
    ECB_GENERIC_KEY,
    GCM_GENERIC_KEY,
};
