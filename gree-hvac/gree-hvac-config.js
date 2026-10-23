module.exports = function (RED) {
    /**
     * @param config
     */
    function GreeHvacConfigNode(config) {
        RED.nodes.createNode(this, config);

        this.host = config.host;
        this.port = Number(config.port) || 7000;

        // Optional resolve-by-MAC: periodically discover the device by its
        // cid/MAC and follow it across DHCP IP changes (see lib/mac-resolver.js).
        this.resolveByMac =
            config.resolveByMac === true || config.resolveByMac === 'true';
        this.mac = (config.mac || '').trim();
        this.broadcastAddress =
            (config.broadcastAddress || '').trim() || '255.255.255.255';
        this.rediscoverInterval = Number(config.rediscoverInterval) || 60;

        // Firmware-specific gree-hvac-client options of this unit.
        // Multi-split: host/MAC address the outdoor unit's WiFi module and
        // subUnit names the indoor unit (a MAC listed by getSubUnits).
        this.subUnit = (config.subUnit || '').trim();
        this.halfDegree =
            config.halfDegree === true || config.halfDegree === 'true';
        this.encodedTargetHumidity =
            config.encodedTargetHumidity === true ||
            config.encodedTargetHumidity === 'true';
        this.statusBatchSize = Math.floor(Number(config.statusBatchSize)) || 20;
    }

    RED.nodes.registerType('gree-hvac-config', GreeHvacConfigNode, {});
};
