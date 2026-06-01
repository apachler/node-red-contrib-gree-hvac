'use strict';

// Minimal Node-RED settings for the local sim stack. Auth is intentionally
// disabled because this container is meant for local development only and
// is not exposed beyond the docker network unless you publish port 1880.

module.exports = {
    flowFile: 'flows.json',
    credentialSecret: 'gree-sim-dev',
    flowFilePretty: true,
    uiPort: process.env.PORT || 1880,
    diagnostics: { enabled: true, ui: true },
    runtimeState: { enabled: false, ui: false },
    logging: {
        console: {
            level: 'info',
            metrics: false,
            audit: false,
        },
    },
    exportGlobalContextKeys: false,
    contextStorage: {
        default: { module: 'localfilesystem' },
        persistent: { module: 'localfilesystem' },
    },
    editorTheme: {
        projects: { enabled: false },
        codeEditor: { lib: 'monaco' },
    },
    functionExternalModules: true,
    functionGlobalContext: {},
    debugMaxLength: 1000,
    mqttReconnectTime: 15000,
    serialReconnectTime: 15000,
};
