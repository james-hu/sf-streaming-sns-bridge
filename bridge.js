const AWS = require('aws-sdk');
const jsforce = require('jsforce');

class Bridge {
    constructor() {
        this.configPromise = null; // {[envName1]: {...connParams1, channels: {channelNameA: arnA, channelNameB: arnB, ... }}, ... }
        this.status = {};   // channelKey: {status, replayId}
        this.subscriptions = {}; // channelKey: {client, subscription}
    }

    status() {
        return Promise.resolve({});
    }

    loadConfig() {
        let configString = process.env.BRIDGE_CONFIG;
        let configStringPromise;
        if (configString == null) {
            const parameterName = process.env.BRIDGE_CONFIG_PARAMETER_STORE;
            if (parameterName != null) {
                configStringPromise = new AWS.SSM()
                    .getParameter({Name: parameterEntry})
                    .promise()
                    .then(r => {
                        this.config = r.Parameter.Value
                    })
                    .catch(err => {
                        throw new Error(`Failed to get parameter '${parameterName}' in '${this.ssm.config.region}': ${err}`);
                    });
            } else {
                throw new Error(`No configuration can be found in environment variable either 'BRIDGE_CONFIG' or 'BRIDGE_CONFIG_PARAMETER_STORE'`);
            }
        } else {
            configStringPromise = Promise.resolve(configString);
        }
        const p = configStringPromise.then(config => {
            try {
                return JSON.parse(config);
            } catch (err) {
                throw new Error(`Failed to parse JSON configuration (${err}): ${config}`)
            };
        });
        this.configPromise = p;
        return p;
    }

    reload() {
        return this.loadConfig()
            .then(() => this.stopAll())
            .then(() => this.startAll());
    }

    startAll() {
        return this.configPromise.then(config => {
            for (let [envName, envDetails] of Object.entries(config)) {
                const conn = new jsforce.Connection(envDetails);
                for (let [channelName, arn] of Object.entries(envDetails.channels)) {
                    const channelKey = `${envName}/${channelName}`;
                    this.status[channelKey] = {status: 'Connecting', replayId: null};
                    // read replayId from DynamoDB
                    const replayId = 3;
                    const replayExt = new jsforce.StreamingExtension.Replay(channelName, replayId);

                    const client = conn.streaming.createClient([ replayExt ]);

                    const subscription = client.subscribe(channel, data => {
                        // send to AWS
                        // update DynamoDB
                    });
                    this.status[channelKey].status = 'Subscribed';
                    this.subscriptions[channelKey] = {client, subscription};
                }
            }
        });
    }

    stopAll() {
        return Promise.resolve({});
    }
}

module.exports = { Bridge };