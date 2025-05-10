import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export interface CommonLayerConstructProps {
  layerName: string;
}

export class CommonLayerConstruct extends Construct {
  public readonly layer: lambda.LayerVersion;

  constructor(scope: Construct, id: string, props: CommonLayerConstructProps) {
    super(scope, id);

    this.layer = new lambda.LayerVersion(this, "CommonLayer", {
      layerVersionName: props.layerName,
      compatibleArchitectures: [lambda.Architecture.ARM_64],
      code: lambda.Code.fromAsset("src/layers/shared", {
        bundling: {
          image: lambda.Runtime.NODEJS_20_X.bundlingImage,
          command: [
            "bash",
            "-c",
            "npm ci --only=production --cache /tmp/.npm-cache && mkdir -p /asset-output/nodejs && cp -r . /asset-output/nodejs",
          ],
        },
      }),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: "Shared layer containing entities and utils",
    });
  }
}
