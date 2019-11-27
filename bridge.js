const log = require('lambda-log');
const AWS = require('aws-sdk');
const Worker = require('./worker').Worker;

class Bridge {
    constructor() {
        this.workers = {};
    }

    status() {
        return Object.entries(this.workers).reduce((result, entry) => {
            const [key, worker] = entry;
            result[key] = worker.buildStatusDTO();
            return result;
        }, {});
    }

    loadConfig() {
        let configString = process.env.BRIDGE_CONFIG;
        let configStringPromise;
        if (configString == null) {
            const parameterName = process.env.BRIDGE_CONFIG_PARAMETER_STORE;
            if (parameterName != null) {
                configStringPromise = new AWS.SSM()
                    .getParameter({Name: parameterName, WithDecryption: true})
                    .promise()
                    .then(r => r.Parameter.Value)
                    .catch(err => {
                        throw new Error(`Failed to get parameter '${parameterName}' from AWS: ${err}`);
                    });
            } else {
                throw new Error(`No configuration can be found in environment variable either 'BRIDGE_CONFIG' or 'BRIDGE_CONFIG_PARAMETER_STORE'`);
            }
        } else {
            configStringPromise = Promise.resolve(configString);
        }
        return configStringPromise.then(config => {
            let obj;
            try {
                obj = JSON.parse(config);
            } catch (err) {
                throw new Error(`Failed to parse JSON configuration (${err}): ${config}`)
            };
            if (obj.options == null) {
                obj.options = {};
            }

            [
                ['replayIdStoreTableName', 'REPLAY_ID_STORE_TABLE_NAME'],
                ['replayIdStoreKeyName', 'REPLAY_ID_STORE_KEY_NAME'],
                ['replayIdStoreDelay', 'REPLAY_ID_STORE_DELAY'],
                ['initialReplayId', 'INITIAL_REPLAY_ID'],
                ['debug', 'DEBUG']
            ].forEach(([name, envName]) => {
                const fullEnvName = 'BRIDGE_CONFIG_' + envName
                const v = process.env[fullEnvName];
                if (v) {
                    obj.options[name] = v;
                    log.info(`Option '${name}' overridded by value read from environment variable '${fullEnvName}': ${v}`);
                }
            });
            return obj;
        });
    }

    reload() {
        return this.loadConfig()
            .then(config => {
                const newWorkers = {};
                const options = config.options;
                log.options.debug = options && options.debug;
                for (let [envName, envDetails] of Object.entries(config).filter(([key, value]) => key !== 'options')) {
                    const sfConnOptions = envDetails.connection;
                    envDetails.channels.forEach(mappingConfig => {
                        const channelKey = `${envName}//${mappingConfig.channelName}`;
                        newWorkers[channelKey] = new Worker(channelKey, sfConnOptions, mappingConfig, options);
                    });
                }
                log.info(`Loaded configuration`, {channels: Object.keys(newWorkers)});
                return newWorkers;
            })
            .then(newWorkers => this.stopAll().then(() => newWorkers))
            .then(newWorkers => {
                this.workers = newWorkers;
                return this.startAll();
            });
    }

    startAll() {
        return this.doAll((key, worker) => 
            worker.start().catch(e => log.error(e, {description: `[${key}] Failed to start`})));
    }

    stopAll() {
        return this.doAll((key, worker) => 
            worker.stop().catch(e => log.error(e, {description: `[${key}] Failed to stop`})));
    }

    doAll(func) {
        return Promise.all(Object.entries(this.workers).map(entry => {
            const [key, worker] = entry;
            return func(key, worker);
        }));
    }
}

module.exports = { Bridge };