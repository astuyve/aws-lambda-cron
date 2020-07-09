"use strict";

const { Component } = require("@serverless/core");
const aws = require(`@serverless/aws-sdk`);

class LambdaCron extends Component {
  async deploy(inputs = {}) {
    const roleParams = {
      name: "my-role",
      service: "lambda.amazonaws.com",
      policy: [
        {
          Effect: "Allow",
          Action: ["sts:AssumeRole"],
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: ["logs:CreateLogGroup", "logs:CreateLogStream"],
          Resource: "*",
        },
      ],
    };
    const { roleArn } = await aws.utils.deployRole(roleParams);

    const lambdaParams = {
      lambdaName: "my-lambda", // required
      roleArn,
      lambdaSrc: await readFile(inputs.src),
      memory: 512,
    };

    const { lambdaArn, lambdaSize, lambdaSha } = await aws.utils.deployLambda(
      lambdaParams
    );
  }
}

module.exports = LambdaCron;
