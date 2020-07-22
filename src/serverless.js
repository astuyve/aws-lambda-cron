"use strict";

const { Component } = require("@serverless/core");
const aws = require("@serverless/aws-sdk-extra");
const fs = require("fs");

const { createOrUpdateMetaRole } = require("./utils");

class LambdaCron extends Component {
  async deploy(inputs = {}) {
    if (Object.keys(this.credentials.aws).length === 0) {
      const msg = `Credentials not found. Make sure you have a .env file in the cwd. - Docs: https://git.io/JvArp`;
      throw new Error(msg);
    }

    if (!inputs.schedule) {
      throw new Error(
        "Input 'schedule' is required. Please see README: https://git.io/JJWW0"
      );
    }
    const region = inputs.region || "us-east-1";
    inputs.name = inputs.name || this.name;

    this.state.name = inputs.name;
    this.state.region = region;

    const extras = new aws.Extras({
      credentials: this.credentials.aws,
      region,
    });

    const roleParams = {
      roleName: `${inputs.name}-role`,
      service: "lambda.amazonaws.com",
      policy: [
        {
          Effect: "Allow",
          Action: ["sts:AssumeRole"],
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents",
          ],
          Resource: "*",
        },
      ],
    };
    const { roleArn } = await extras.deployRole(roleParams);
    this.state.roleName = roleParams.roleName;

    const lambdaParams = {
      lambdaName: `${inputs.name}-lambda`, // required
      roleArn,
      lambdaSrc: await fs.promises.readFile(inputs.src),
      memory: inputs.memory || 512,
      timeout: inputs.timeout || 60,
      env: inputs.env,
    };

    const { lambdaArn, lambdaSize, lambdaSha } = await extras.deployLambda(
      lambdaParams
    );
    this.state.lambdaName = lambdaParams.lambdaName;

    const putRuleParams = {
      Name: `${inputs.name}-rule`,
      ScheduleExpression: inputs.schedule,
      Description: `Lambda-Cron schedule rule for ${inputs.name}`,
    };

    const cwEvents = new aws.CloudWatchEvents({
      credentials: this.credentials.aws,
      region,
    });
    const { RuleArn } = await cwEvents.putRule(putRuleParams).promise();
    this.state.cloudWatchRule = putRuleParams.Name;

    const lambda = new aws.Lambda({
      credentials: this.credentials.aws,
      region,
    });
    const lambdaPermissions = {
      StatementId: `${inputs.name}-lambda-permission`,
      FunctionName: lambdaParams.lambdaName,
      Action: "lambda:InvokeFunction",
      Principal: "events.amazonaws.com",
      SourceArn: RuleArn,
    };

    try {
      await lambda.addPermission(lambdaPermissions).promise();
    } catch (error) {
      console.log(
        "CloudWatch Events permission already added to lambda, continuing"
      );
    }

    const targetParams = {
      Rule: putRuleParams.Name,
      Targets: [
        {
          Arn: lambdaArn,
          Id: `${inputs.name}-target`,
        },
      ],
    };
    const response = await cwEvents.putTargets(targetParams).promise();
    this.state.targetId = targetParams.Targets.Id;

    await createOrUpdateMetaRole(this, inputs, extras, this.accountId);
  }
  async remove() {
    if (Object.keys(this.credentials.aws).length === 0) {
      const msg = `Credentials not found. Make sure you have a .env file in the cwd. - Docs: https://git.io/JvArp`;
      throw new Error(msg);
    }
    const region = this.state.region || "us-east-1";

    const extras = new aws.Extras({
      credentials: this.credentials.aws,
      region,
    });

    console.log("removing execution role");
    await extras.removeRole({ roleName: this.state.roleName });
    console.log("removing meta role");
    await extras.removeRole({ roleName: this.state.metaRoleName });
    await extras.removeLambda({ lambdaName: this.state.lambdaName });
    const cwEvents = new aws.CloudWatchEvents({
      credentials: this.credentials.aws,
      region,
    });
    await cwEvents.deleteRule(this.state.cloudWatchRule);
    // Clear state, we did it team
    this.state = {};
  }
  /**
   * Metrics
   */
  async metrics(inputs = {}) {
    console.log("Fetching metrics...");

    /**
     * Create AWS STS Token via the meta role that is deployed with the Express Component
     */

    // Assume Role
    const assumeParams = {};
    assumeParams.RoleSessionName = `session${Date.now()}`;
    assumeParams.RoleArn = this.state.metaRoleArn;
    assumeParams.DurationSeconds = 900;

    const region = this.state.region;
    const sts = new aws.STS({ region });
    const resAssume = await sts.assumeRole(assumeParams).promise();

    const roleCreds = {};
    roleCreds.accessKeyId = resAssume.Credentials.AccessKeyId;
    roleCreds.secretAccessKey = resAssume.Credentials.SecretAccessKey;
    roleCreds.sessionToken = resAssume.Credentials.SessionToken;

    const resources = [
      {
        type: "aws_lambda",
        functionName: this.state.lambdaName,
      },
    ];

    /**
     * Instantiate a new Extras instance w/ the temporary credentials
     */

    const extras = new aws.Extras({
      credentials: roleCreds,
      region,
    });

    return await extras.getMetrics({
      rangeStart: inputs.rangeStart,
      rangeEnd: inputs.rangeEnd,
      resources,
    });
  }
}

module.exports = LambdaCron;
