const AWS = require('aws-sdk');
const jsforce = require('jsforce');

const STATUS_INITIALIZED = "Initialized";
const STATUS_STARTING = "Starting";
const STATUS_STARTED = "Started";
const STATUS_STOPPING = "Stopping";
const STATUS_STOPPED = "Stopped";

class Worker {
    /**
     * 
     * @papram {string} workerId
     * @param {*} sfConnOptions 
     * @param {*} mappingConfig     {channelName, snsTopicArn}
     * @param {*} options  {replayIdStoreTableName, replayIdStoreKeyName, replayIdStoreDelay}
     */
    constructor(workerId, sfConnOptions, mappingConfig, options) {
        this.workerId = workerId;

        this.sns = new AWS.SNS();
        this.ddb = new AWS.DynamoDB();

        this.sfConnOptions = sfConnOptions;

        this.channelName = mappingConfig.channelName;
        this.snsTopicArn = mappingConfig.snsTopicArn;

        this.replayIdStoreTableName = options && options.replayIdStoreTableName;
        this.replayIdStoreKeyName = (options && options.replayIdStoreKeyName) || 'channel';
        this.replayIdStoreDelay = (options && options.replayIdStoreDelay) || 2000;
        this.debug = options && options.debug;

        this.status = STATUS_INITIALIZED;
        this.replayId = null;
        this.lastReplayIdStoredTime = 0;

        this.logMessages = new Array(20);
        this.recentMessages = new Array(20);

        this.connection = null;
        this.streamingClient = null;
        this.subscription = null;
    }

    buildStatusDTO() {
        return {
            status: this.status,
            replayId: this.replayId,
            log: this.logMessages,
            recentMessages: this.recentMessages,
        }
    }

    log(message) {
        this.logMessages.unshift({time: new Date().toISOString(), message});
        this.logMessages.pop();
    }

    logReceivedMessage(replayId) {
        this.recentMessages.unshift({time: new Date().toISOString(), replayId});
        this.recentMessages.pop();
    }

    fetchReplayId() {
        if (this.replayIdStoreTableName) {
            // get from DynamoDB
        }
        return Promise.resolve(-2);
    }

    /**
     * Store replay id to DynamoDB if configured, or no-op otherwise.
     * @param {boolean} flush if true the actual Promise would be returned, otherwise Promise.resolve() would be returned.
     * @returns Promise for the save operation or no-op
     */
    storeReplayId(flush) {
        if (this.replayIdStoreTableName) {
            const now = new Date().getTime();
            const moreToWait = this.replayIdStoreDelay - (now - this.lastReplayIdStoredTime);
            if (flush || moreToWait <= 0) {
                // save to DynamoDb
                const p = Promise.resolve();
                return flush? p : Promise.resolve();
            } else {
                setTimeout(this.storeReplayId.bind(this), moreToWait + 100);
            }
        }
        return Promise.resolve();
    }

    publishToSNS(payload) {
        return this.sns.publish({
            Message: payload,
            TopicArn: this.snsTopicArn,
        }).promise()
        .then(result => {
            if(this.debug) {
                console.log(`[${this.workerId}] Published to SNS:\n${JSON.stringify(payload, null, 2)}`);
            }
            return result.MessageId;
        });
    }

    subscribeCallback(data) {
        if (this.status !== STATUS_STOPPING && this.status != STATUS_STOPPED) {
            if (this.debug) {
                console.log(`[${this.workerId}] Received:\n${JSON.stringify(data, null, 2)}`);
            }
            const previousReplayId = this.replayId;
            const newReplayId = data.event.replayId;
            this.logReceivedMessage(newReplayId);
            const payload = data.payload;
            const payloadJson = JSON.stringify(payload);
            this.publishToSNS(payloadJson).then(() => {
                if(this.debug) {
                    console.log(`[${this.workerId}] Published to SNS (replayId=${newReplayId}):\n${JSON.stringify(payload, null, 2)}`);
                }
                if (this.replayId === previousReplayId || this.replayId < newReplayId) {
                    this.replayId = newReplayId;
                    this.storeReplayId();
                } else {
                    console.log(`replayId not updated because: previous=${previousReplayId}, new=${newReplayId}, current=${this.replayId}`);
                }
            })
            .catch(e => {
                this.log(`Failed to publish to SNS (replayId=${newReplayId}): ${e}`);
                if (this.debug) {
                    console.log(`[${this.workerId}] Failed to publish to SNS (replayId=${newReplayId}): ${e}`);
                }
            });
        }
    }

    restart() {
        this.stop();
        this.start();
    }

    start() {
        console.log(`Starting: ${this.workerId}`);
        this.status = STATUS_STARTING;
        this.log('Fetching initial replayId');
        return this.fetchReplayId().then(replayId => {
            this.replayId = replayId;
            const replayExt = new jsforce.StreamingExtension.Replay(this.channelName, this.replayId);
            const authFailureExt = new jsforce.StreamingExtension.AuthFailure(() => {
                this.log('Restart needed because of auth error (probably expired)')
                setTimeout(this.restart.bind(this), 0);
            });
            
            this.connection = new jsforce.Connection(this.sfConnOptions);
            this.log('Logging in Salesforce')
            return this.connection.login(this.sfConnOptions.username, this.sfConnOptions.password + this.sfConnOptions.token)
                    .then(userInfo => {
                        this.log(`Creating streaming client for '${this.channelName}' with initial replayId ${this.replayId}`);
                        this.streamingClient = this.connection.streaming.createClient([ authFailureExt, replayExt ]);
                        this.log(`Creating subscription`);
                        this.subscription = this.streamingClient.subscribe(this.channelName, this.subscribeCallback.bind(this));
                        this.status = STATUS_STARTED;
                        this.log('Subscription created');
                    });
        });
    }

    stop() {
        this.status = STATUS_STOPPING;
        if (this.subscription != null) {
            this.log('Cancelling subscription');
            this.subscription.cancel();
            this.status = STATUS_STOPPED;
            this.log('Cancelled subscription');
        }
        this.subscription = null;
        this.streamingClient = null;
        this.connection = null;
        return this.storeReplayId(true);
    }
}

module.exports = { Worker };