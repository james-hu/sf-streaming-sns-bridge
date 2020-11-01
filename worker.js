const log = require('lambda-log');
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
     * @param {*} options  {replayIdStoreTableName, replayIdStoreKeyName, replayIdStoreDelay, initialReplayId}
     */
    constructor(workerId, sfConnOptions, mappingConfig, options) {
        this.workerId = workerId;

        this.sns = new AWS.SNS();
        this.ddb = new AWS.DynamoDB.DocumentClient();

        this.sfConnOptions = sfConnOptions;

        this.channelName = mappingConfig.channelName;
        this.snsTopicArn = mappingConfig.snsTopicArn;

        this.replayIdStoreTableName = options && options.replayIdStoreTableName;
        this.replayIdStoreKeyName = (options && options.replayIdStoreKeyName) || 'channel';
        this.replayIdStoreDelay = (options && options.replayIdStoreDelay) || 2000;
        this.initialReplayId = (options && options.initialReplayId) || -1;
        this.debug = options && options.debug;

        this.status = STATUS_INITIALIZED;
        this.replayId = null;
        this.lastReplayIdStoredTime = 0;
        this.lastReplayIdStored = null;

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
            return this.ddb.get({
                TableName: this.replayIdStoreTableName,
                Key: {
                    [this.replayIdStoreKeyName]: this.workerId,
                },
            }).promise()
            .then(result => {
                if (result.Item && result.Item.replayId) {
                    return result.Item.replayId;
                } else {
                    this.log(`There is no previously stored replayId, will use ${this.initialReplayId}`);
                    return this.initialReplayId;
                }
            })
            .catch(e => {
                this.log(`Couldn't fetch previously stored replayId, will use ${this.initialReplayId}: ${e}`);
                return this.initialReplayId;
            });
        }
        return Promise.resolve(this.initialReplayId);
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
                const newReplayId = this.replayId;
                const p = this.ddb.update({
                    TableName: this.replayIdStoreTableName,
                    Key: {
                        [this.replayIdStoreKeyName]: this.workerId,
                    },
                    UpdateExpression: "set replayId = :newReplayId",
                    ConditionExpression: `attribute_not_exists(${this.replayIdStoreKeyName}) or attribute_not_exists(replayId) or replayId < :newReplayId`,
                    ExpressionAttributeValues:{
                        ":newReplayId": newReplayId,
                    },
                }).promise()
                .then(result => {
                    this.lastReplayIdStored = newReplayId;
                })
                .catch(e => {
                    this.log(`Didn't store replayId ${newReplayId}: ${e}`);
                });
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
        .then(result => result.MessageId);
    }

    subscribeCallback(data) {
        if (this.status !== STATUS_STOPPING && this.status != STATUS_STOPPED) {
            const newReplayId = data.event.replayId;
            const logMeta = {worker: this.workerId, replayId: newReplayId};
            if (this.debug) {
                log.debug(`[${this.workerId}] Received message`, {...logMeta, data});
            }
            const previousReplayId = this.replayId;
            this.logReceivedMessage(newReplayId);
            const payload = data.payload;
            const payloadJson = JSON.stringify(payload);
            this.publishToSNS(payloadJson).then(() => {
                if(this.debug) {
                    log.debug(`[${this.workerId}] Published to SNS (replayId=${newReplayId})`, {...logMeta, payload});
                }
                if (this.replayId === previousReplayId || this.replayId < newReplayId) {
                    this.replayId = newReplayId;
                    this.storeReplayId();
                } else {
                    log.debug(`replayId not updated because: previous=${previousReplayId}, new=${newReplayId}, current=${this.replayId}`, {...logMeta});
                }
            })
            .catch(e => {
                this.log(`Failed to publish to SNS (replayId=${newReplayId}): ${e}`);
                if (this.debug) {
                    log.debug(`[${this.workerId}] Failed to publish to SNS (replayId=${newReplayId})`, {...logMeta, error: e});
                }
            });
        }
    }

    restart() {
        this.stop();
        this.start();
    }

    start() {
        log.info(`Starting: ${this.workerId}`);
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
        log.info(`Stopping: ${this.workerId}`);
        this.status = STATUS_STOPPING;
        for (let i = 0; i < 5 && this.subscription != null; i ++) {
            this.log('Cancelling subscription');
            log.info(`Cancelling subscription: ${this.workerId}`);
            try {
                this.subscription.cancel();
                this.log('Cancelled subscription');
                this.subscription = null;
            } catch (err) {
                this.log('Failed to cancel subscription');
                log.warn(`Failed to cancel subscription: ${this.workerId}`);
            }
        }
        if (this.subscription != null) {
            this.log('Failed to cancel subscription after retries');
            log.error(`Failed to cancel subscription after retries: ${this.workerId}`);
            this.subscription = null;
        }
        this.status = STATUS_STOPPED;
        this.log('Stopped');
        log.info(`Stopped: ${this.workerId}`);
        this.streamingClient = null;
        this.connection = null;
        return this.storeReplayId(true);
    }
}

module.exports = { Worker };