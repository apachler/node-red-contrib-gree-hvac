'use strict';

// Requests a gree-hvac node takes as msg.action besides setting properties.
// Each maps the msg to the arguments of the gree-hvac-client method of that
// name (throwing on a bad payload); `reply` replaces the method's result as
// the payload sent on output 4.

const pad = n => String(n).padStart(2, '0');

/**
 * @param {Date} d
 * @returns {string} the unit's clock format: local time, YYYY-MM-DD HH:MM:SS
 */
const fmtClock = d =>
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes()) +
    ':' +
    pad(d.getSeconds());

const ACTIONS = {
    getProperties: { args: () => [] },
    getDeviceInfo: { args: () => [] },
    getSubUnits: {
        args: msg =>
            Number(msg.timeout) > 0 ? [{ timeout: Number(msg.timeout) }] : [],
    },
    getVendorProperties: {
        args: msg => {
            const codes = [].concat(msg.payload);
            if (!codes.every(c => typeof c === 'string' && c)) {
                throw new Error(
                    'getVendorProperties: payload must be a vendor code or an array of them'
                );
            }
            return [codes];
        },
    },
    setVendorProperties: {
        args: msg => {
            const p = msg.payload;
            if (
                !p ||
                typeof p !== 'object' ||
                Array.isArray(p) ||
                Object.keys(p).length === 0
            ) {
                throw new Error(
                    'setVendorProperties: payload must be an object of vendor code -> value'
                );
            }
            return [p];
        },
        reply: args => args[0],
    },
    getClock: { args: () => [] },
    setClock: {
        args: msg => {
            const p = msg.payload;
            const now = p === undefined || p === null || p === '' || p === true;
            const date = now ? new Date() : new Date(p);
            if (Number.isNaN(date.getTime())) {
                throw new Error(
                    'setClock: payload must be empty (now), a Date, a timestamp or a date string'
                );
            }
            return [date];
        },
        reply: args => fmtClock(args[0]),
    },
    setName: {
        args: msg => {
            if (typeof msg.payload !== 'string' || !msg.payload.trim()) {
                throw new Error('setName: payload must be the new name');
            }
            return [msg.payload.trim()];
        },
        reply: args => args[0],
    },
};

/**
 * @param {string} name
 * @returns {object|null} the action of that name
 */
const getAction = name =>
    Object.prototype.hasOwnProperty.call(ACTIONS, name) ? ACTIONS[name] : null;

module.exports = { ACTIONS, getAction, fmtClock };
