"use strict";

const { Component } = require("@serverless/core");
const aws = require(`@serverless/aws-sdk`);
const fs = require("fs");

class LambdaCron extends Component {
  async deploy(inputs = {}) {
    if (Object.keys(this.credentials.aws).length === 0) {
      const msg = `Credentials not found. Make sure you have a .env file in the cwd. - Docs: https://git.io/JvArp`;
      throw new Error(msg);
    }

    const region = inputs.region || "us-east-1";

    this.state.region = region;
    aws.config.update({
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
    const { roleArn } = await aws.utils.deployRole(roleParams);
    this.state.roleName = roleParams.roleName;

    const lambdaParams = {
      lambdaName: `${inputs.name}-lambda`, // required
      roleArn,
      lambdaSrc: await fs.promises.readFile(inputs.src),
      memory: inputs.memory || 512,
    };

    const { lambdaArn, lambdaSize, lambdaSha } = await aws.utils.deployLambda(
      lambdaParams
    );
    this.state.lambdaName = lambdaParams.lambdaName;

    const putRuleParams = {
      Name: `${inputs.name}-rule`,
      ScheduleExpression: inputs.schedule,
      Description: `Lambda-Cron schedule rule for ${inputs.name}`,
    };

    const cwEvents = new aws.CloudWatchEvents();
    const { RuleArn } = await cwEvents.putRule(putRuleParams).promise();
    this.state.cloudWatchRule = putRuleParams.Name;

    const lambda = new aws.Lambda();
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
      console.log("permission already added to lambda, continuing");
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
  }
  async remove() {
    if (Object.keys(this.credentials.aws).length === 0) {
      const msg = `Credentials not found. Make sure you have a .env file in the cwd. - Docs: https://git.io/JvArp`;
      throw new Error(msg);
    }

    aws.config.update({
      credentials: this.credentials.aws,
      region: this.state.region || "us-east-1",
    });

    await aws.utils.removeRole({ roleName: this.state.roleName });
    await aws.utils.removeLambda({ lambdaName: this.state.lambdaName });
    const cwEvents = new aws.CloudWatchEvents();
    await cwEvents.deleteRule(this.state.cloudWatchRule);
    // Clear state, we did it team
    this.state = {};
  }
}

module.exports = LambdaCron;
