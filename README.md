# sf-pe-sns-bridge: Salesforce Platform Events SNS Bridge

Node.js application (AWS Elastic Beanstalk friendly) for
bridging Salesforce Platform Events to AWS SNS topics.

This application listens on Salesforce Platform Events and forward all
messages to AWS SNS topics.

* Having multiple Salesforce logins each with multiple channels is supported.
* Each channel can be configured to have messages forwarded to an AWS SNS topic.
* Configurations are read from AWS Systems Manager Parameter Store.
* Checkpoints are stored in AWS DynamoDB to avoid missing event.
* Reconnect and retry logic built-in.
* Optimized for AWS Elastic Beanstalk but can also be executed in any Node.js environment.
