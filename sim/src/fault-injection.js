'use strict';

class FaultInjector {
    constructor(opts = {}) {
        this.dropProbability = clamp01(opts.dropProbability || 0);
        this.latencyMs = Math.max(0, opts.latencyMs || 0);
        this.jitterMs = Math.max(0, opts.jitterMs || 0);
        this.dropEvery = Math.max(0, Math.floor(opts.dropEvery || 0));
        this._counter = 0;
    }

    shouldDrop() {
        this._counter++;
        if (this.dropEvery > 0 && this._counter % this.dropEvery === 0) {
            return true;
        }
        if (this.dropProbability > 0 && Math.random() < this.dropProbability) {
            return true;
        }
        return false;
    }

    delay() {
        if (!this.latencyMs && !this.jitterMs) return 0;
        const jitter = this.jitterMs
            ? Math.floor(Math.random() * this.jitterMs)
            : 0;
        return this.latencyMs + jitter;
    }

    update(opts = {}) {
        if (opts.dropProbability !== undefined)
            this.dropProbability = clamp01(opts.dropProbability);
        if (opts.latencyMs !== undefined)
            this.latencyMs = Math.max(0, opts.latencyMs);
        if (opts.jitterMs !== undefined)
            this.jitterMs = Math.max(0, opts.jitterMs);
        if (opts.dropEvery !== undefined)
            this.dropEvery = Math.max(0, Math.floor(opts.dropEvery));
    }

    snapshot() {
        return {
            dropProbability: this.dropProbability,
            latencyMs: this.latencyMs,
            jitterMs: this.jitterMs,
            dropEvery: this.dropEvery,
        };
    }
}

function clamp01(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
}

module.exports = { FaultInjector };
