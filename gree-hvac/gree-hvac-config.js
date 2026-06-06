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
    }

    RED.nodes.registerType('gree-hvac-config', GreeHvacConfigNode, {});
};
