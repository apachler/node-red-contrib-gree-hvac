module.exports = function (RED) {
    /**
     * @param config
     */
    function GreeHvacConfigNode(config) {
        RED.nodes.createNode(this, config);

        this.host = config.host;
        this.port = Number(config.port) || 7000;
    }

    RED.nodes.registerType('gree-hvac-config', GreeHvacConfigNode, {});
};
