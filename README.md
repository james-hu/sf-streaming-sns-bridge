# sf-streaming-sns-bridge: Salesforce Streaming Events SNS Bridge

Node.js application (AWS Elastic Beanstalk friendly) for
bridging Salesforce Streaming Events to AWS SNS topics.

This application listens on Salesforce Streaming Events and forward all
messages to AWS SNS topics.

* Having multiple Salesforce logins each with multiple channels is supported.
* Each channel can be configured to have messages forwarded to an AWS SNS topic.
  (If forwarding to more than one SNS topics is needed, you can configure multiple entries with the same channel)
* Configurations can be read from AWS Systems Manager Parameter Store, or an environment variable.
* Checkpoints can be stored in AWS DynamoDB to avoid missing event during restarts.
* Reconnect and retry logic built-in.
* Optimized for AWS Elastic Beanstalk but can also be executed in any Node.js environment as a console application.

## Configuration

When starting, the application listens on a port to provide REST API for management purpose.
The port number can be specified in environment variable `PORT`, or if it is not set, port `8080` would be used.

Configuration is in JSON format, like this:

```js
{
    "options": {
        "replayIdStoreTableName": "your-dynamodb-table-name-for-storing-replay-id-checkpoint",
        "replayIdStoreKeyName": "channel",  // if not set, default to "channel"
        "replayIdStoreDelay": 2000,         // if not set, default to 2000
        "debug": false                      // enable debug to see events logged to console
    },
    "test1": {
        "connection": {
            "clientId": "",
            "clientSecret": "",
            "loginUrl": "https://test.salesforce.com",
            "redirectUri": "https://login.salesforce.com",
            "username": "",
            "password": "",
            "token": ""             // secure token of the user
        },
        "channels": [
            {
                "channelName": "/event/the-name-in-Salesforce__e",
                "snsTopicArn": "your-AWS-SNS-topic-ARN"
            },
            {
                "channelName": "",
                "snsTopicArn": ""
            }
        ]
    },
    "test2": {
        "connection": {
            "clientId": "",
            "clientSecret": "",
            "loginUrl": "https://test.salesforce.com",
            "redirectUri": "https://login.salesforce.com",
            "username": "",
            "password": "",
            "token": ""             // secure token of the user
        },
        "channels": [
            {
                "channelName": "",
                "snsTopicArn": ""
            },
            {
                "channelName": "",
                "snsTopicArn": ""
            },
            {
                "channelName": "",
                "snsTopicArn": ""
            }
        ]
    }
}
```

Configuration can be provided in these ways:

* As a long string in environment variable `BRIDGE_CONFIG`.
* As a string in AWS Systems Manager Parameter Store.
  Name of the parameter must be provided through environment variable `BRIDGE_CONFIG_PARAMETER_STORE`.

## Checkpoint

Optionally, you can provide a DynamoDB table for keeping checkpoints of Replay IDs.
If you do, the table name should be put in the `options` -> `replayIdStoreTableName` entry in the configuration.
Checkpoint interval can be put in the `options` -> `replayIdStoreDelay` entry in the configuration.
Value in `replayIdStoreDelay` is a number representing the number of milliseconds that the Replay ID
in DynamoDB should be updated peridically.

If `replayIdStoreTableName` is `null` then checkpointing won't happen.

## Run it locally

To run it locally for demo purpose, you need to:

```bash
npm ci
export AWS_REGION=...
export BRIDGE_CONFIG=...
npm start
```
