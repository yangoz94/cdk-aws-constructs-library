import { Construct } from "constructs";
import * as amp from "aws-cdk-lib/aws-aps";
import * as ssm from "aws-cdk-lib/aws-ssm";

export interface AWSManagedPrometheusConstructProps {
  appName: string;
  tagEnv: string;
  environment: string;
  region: string;
}

export class AWSManagedPrometheusConstruct extends Construct {
  public readonly prometheusWorkspace: amp.CfnWorkspace;
  public readonly workspaceId: string;
  public readonly workspaceArn: string;
  public readonly prometheusEndpoint: string;
  public readonly remoteWriteUrl: string;
  public readonly queryUrl: string;

  constructor(
    scope: Construct,
    id: string,
    props: AWSManagedPrometheusConstructProps
  ) {
    super(scope, id);

    /* Create AWS Managed Prometheus workspace */
    this.prometheusWorkspace = new amp.CfnWorkspace(
      this,
      "PrometheusWorkspace",
      {
        alias: `${props.appName}-${props.tagEnv}-prometheus-workspace`,
        tags: [
          {
            key: "Project",
            value: props.appName,
          },
          {
            key: "Environment",
            value: props.tagEnv,
          },
          {
            key: "Auto-generated",
            value: "true",
          },
          {
            key: "Auto-generated-tool",
            value: "aws-cdk",
          },
        ],
      }
    );

    /* Extract workspace information */
    this.workspaceId = this.prometheusWorkspace.attrWorkspaceId;
    this.workspaceArn = this.prometheusWorkspace.attrArn;
    this.prometheusEndpoint = this.prometheusWorkspace.attrPrometheusEndpoint;
    this.remoteWriteUrl = `${this.prometheusWorkspace.attrPrometheusEndpoint}api/v1/remote_write`;
    this.queryUrl = `${this.prometheusWorkspace.attrPrometheusEndpoint}api/v1/query`;

    /* Store workspace information in SSM Parameter Store */
    new ssm.StringParameter(this, "PrometheusWorkspaceIdParam", {
      parameterName: `/${props.appName}/${props.tagEnv}/prometheus/workspace-id`,
      stringValue: this.workspaceId,
      description: "Amazon Managed Prometheus Workspace ID",
    });

    new ssm.StringParameter(this, "PrometheusWorkspaceArnParam", {
      parameterName: `/${props.appName}/${props.tagEnv}/prometheus/workspace-arn`,
      stringValue: this.workspaceArn,
      description: "Amazon Managed Prometheus Workspace ARN",
    });

    new ssm.StringParameter(this, "PrometheusEndpointParam", {
      parameterName: `/${props.appName}/${props.tagEnv}/prometheus/endpoint`,
      stringValue: this.prometheusEndpoint,
      description: "Amazon Managed Prometheus Endpoint URL",
    });

    new ssm.StringParameter(this, "PrometheusRemoteWriteUrlParam", {
      parameterName: `/${props.appName}/${props.tagEnv}/prometheus/remote-write-url`,
      stringValue: this.remoteWriteUrl,
      description: "Amazon Managed Prometheus Remote Write URL",
    });
  }
}
