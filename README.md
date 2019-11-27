# Bridge for forwarding Salesforce Streaming Events to AWS SNS topics

Node.js application (Docker and AWS ECS/EB ready) for
bridging Salesforce Streaming Events to AWS SNS topics.

This application listens for Salesforce Streaming Events and forwards all
messages to AWS SNS topics.

Main features are:

* All [kinds of events](https://developer.salesforce.com/docs/atlas.en-us.api_streaming.meta/api_streaming/terms.htm)
  are supported: PushTopics, Platform Events, and Change Data Capture Events.
* You can configure multiple Salesforce logins each with multiple
  [channels](https://developer.salesforce.com/docs/atlas.en-us.api_streaming.meta/api_streaming/terms.htm).
* Each channel can be configured to have messages forwarded to an
  [AWS SNS topic](https://docs.aws.amazon.com/sns/latest/dg/welcome.html).
* Configurations can be put in one of these sources:
  * Environment variable
  * AWS Systems Manager Parameter Store
* Checkpoints can be stored in AWS DynamoDB to avoid missing events during restarts.
* Reconnect and retry logic built-in.
* REST API endpoints for managing and monitoring.
* Docker image [available on DockerHub](https://hub.docker.com/r/jameshu/sf-streaming-sns-bridge).
* Optimized for AWS Elastic Beanstalk and ECS but can also be executed in any Node.js environment as a console application.

## Configuration

When starting, the application listens on a port to provide REST API for management purpose.
The port number can be specified in environment variable `BRIDGE_PORT` or `PORT`,
or if none of them is set port `8080` would be used.

All other configurations are structured as a JSON text, stored in one of these places:

* Environment variable `BRIDGE_CONFIG`
* AWS Systems Manager Parameter Store, the name of the parameter is read from environment variable `BRIDGE_CONFIG_PARAMETER_STORE`

New lines and spaces in the JSON text are not necessary, especially when the configuration
is put in the environment variable.

The JSON text has this structure:

```js
{
    "options": {
        "replayIdStoreTableName": "dynamodb-table-name", // Name of the DynamoDB table used for storing
                                                            // Replay ID checkpoints. It must exist in the
                                                            // default AWS region as the bridge is running in.
                                                            // If not set, checkpointing would be disabled.
        "replayIdStoreKeyName": "channel",  // Name of the partition key in the DynamoDb table.
                                               // If not set then default to "channel"
        "replayIdStoreDelay": 2000,         // The maximum delay (as number of milliseconds) before the
                                               // newly received Replay ID would be saved into the DynamoDB
                                               // table. If not set then default to 2000.
        "initialReplayId": -1               // The starting Replay ID to use in case there is no previously
                                               // saved checkpoint in the DynamoDB table. If not set then
                                               // default to -1.
        "debug": false                      // If it is true, then messages received and forwarded would
                                               // be logged to console.
    },
    "test1": {  // The name of the Salesforce environment/sandbox,
                   // can be any text you like, but please avoid having '//' in it.
        "connection": {     // Salesforce connection parameters
            "clientId": "of-the-connected-app",
            "clientSecret": "of-the-connected-app",
            "loginUrl": "https://test.salesforce.com",
            "redirectUri": "https://login.salesforce.com",
            "username": "user-name",
            "password": "password of the user",
            "token": "secure-token-of-the-user"
        },
        "channels": [       // Can have multiple channels configured here
            {
                "channelName": "/event/the-name-in-Salesforce__e",
                "snsTopicArn": "your-AWS-SNS-topic-ARN"
            },
            {
                "channelName": "/event/another-name-in-Salesforce__e",
                "snsTopicArn": "your-AWS-SNS-topic-ARN"
            }
        ]
    },
    "test2": {  // Can have multiple Salesforce environment/sandbox
        "connection": {     // Salesforce connection parameters
            "clientId": "of-the-connected-app",
            "clientSecret": "of-the-connected-app",
            "loginUrl": "https://test.salesforce.com",
            "redirectUri": "https://login.salesforce.com",
            "username": "user-name",
            "password": "password of the user",
            "token": "secure-token-of-the-user"
        },
        "channels": [       // Can have multiple channels configured here
            {
                "channelName": "/event/the-name-in-Salesforce__e",
                "snsTopicArn": "your-AWS-SNS-topic-ARN"
            },
            {
                "channelName": "/event/another-name-in-Salesforce__e",
                "snsTopicArn": "your-AWS-SNS-topic-ARN"
            }
        ]
    }
}
```

Some configuration items can be overridden by environment variables:

* `BRIDGE_CONFIG_REPLAY_ID_STORE_TABLE_NAME`
* `BRIDGE_CONFIG_REPLAY_ID_STORE_KEY_NAME`
* `BRIDGE_CONFIG_REPLAY_ID_STORE_DELAY`
* `BRIDGE_CONFIG_INITIAL_REPLAY_ID`
* `BRIDGE_CONFIG_DEBUG`

## Checkpoint

For production usage, checkpointing is needed. That means, the bridge would periodically
save the Replay ID of the last forwarded message into the DynamoDB table specified by
the configuration entry `replayIdStoreTableName`. And when the bridge starts or reloads,
it would read the saved Replay ID from DynamoDB table and tries to catch up from there.

If `replayIdStoreTableName` is not configured, checkpointing is disabled.
If both `replayIdStoreTableName` and `initialReplayId` are not configured,
the bridge would not try to catch up, it would receive only new messages.

`replayIdStoreDelay` Controls how frequently checkpointing happens.
The actual DynamoDB write frequency is always no more than the frequency that messages arrive.
That means, if there is only one message every hour, setting `replayIdStoreDelay` to
1 millisecond won't result in 1000 writes per second, the actual write frequency would
still be once per hour. However, if the message comes at a frequency of 1/second, setting
`replayIdStoreDelay` to 60000 milliseconds would result in roughly 1 DynamoDB write per minute.

## How to run it

To run it locally for demo purpose, you can do this:

```bash
npm ci
export AWS_REGION=...
export BRIDGE_CONFIG=...
npm start
```

or this:

```bash
AWS_REGION=ap-southeast-2 BRIDGE_CONFIG_PARAMETER_STORE=/your/aws/param/store/name npm start
```

Or, you can get the pre-built Docker image from Docker Hub and use docker to run it:
[jameshu/sf-streaming-sns-bridge](https://hub.docker.com/r/jameshu/sf-streaming-sns-bridge)

## REST API

After starting up, you can access the bridge's REST API endpoints to manage it:

* `/health` - returns whether the bridge is `UP` or `DOWN`
* `/status` - returns the detailed status of each channel-SNS pair
* `/reload` - instruct the bridge to re-read configurations and then restart all channel-SNS pairs
