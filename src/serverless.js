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

    aws.config.update({
      credentials: this.credentials.aws,
      region: inputs.region,
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

    const lambdaParams = {
      lambdaName: `${inputs.name}-lambda`, // required
      roleArn,
      lambdaSrc: await fs.promises.readFile(inputs.src),
      memory: 512,
    };

    const { lambdaArn, lambdaSize, lambdaSha } = await aws.utils.deployLambda(
      lambdaParams
    );

    const putRuleParams = {
      Name: `${inputs.name}-rule`,
      ScheduleExpression: inputs.schedule,
      Description: `Lambda-Cron schedule rule for ${inputs.name}`,
    };

    const cwEvents = new aws.CloudWatchEvents();
    const { RuleArn } = await cwEvents.putRule(putRuleParams).promise();

    const lambda = new aws.Lambda();
    const lambdaPermissions = {
      StatementId: `${inputs.name}-lambda-permission`,
      FunctionName: lambdaParams.lambdaName,
      Action: "lambda:InvokeFunction",
      Principal: "events.amazonaws.com",
      SourceArn: RuleArn,
    };

    await lambda.addPermission(lambdaPermissions).promise();

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
  }
}

module.exports = LambdaCron;
