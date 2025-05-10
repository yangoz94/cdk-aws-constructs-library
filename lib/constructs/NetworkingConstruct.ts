import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";

/**
 * Properties for configuring the NetworkingConstruct.
 */
interface NetworkingConstructProps extends cdk.StackProps {
  /**
   * The application name to use as a prefix in resource names.
   */
  appName: string;
}

/**
 * Creates a VPC with an internet gateway,
 * public and private isolated subnets, and appropriate route tables. It is designed to be cost-effective for simple personal websites/blogs.
 * Therefore, it does NOT include NAT gateways and private subnets with egress to the internet by choice.
 *
 * This construct is suitable for applications that do not require a NAT gateway for private subnet access to the internet.
 *
 * @example
 * const networking = new NetworkingConstruct(this, 'MyNetworking', {
 *   appName: 'my-personal-website',
 * });
 */
export class NetworkingConstruct extends Construct {
  /**
   * The created VPC resource.
   */
  public readonly vpc: ec2.Vpc;

  /**
   * Constructs a new instance of the NetworkingConstruct.
   *
   * @param {Construct} scope - The parent construct, typically a CDK stack.
   * @param {string} id - The unique identifier for this construct.
   * @param {NetworkingConstructProps} props - Properties for configuring the VPC.
   */
  constructor(scope: Construct, id: string, props: NetworkingConstructProps) {
    super(scope, id);

    /* Create a VPC with public and private isolated subnets. */
    this.vpc = new ec2.Vpc(this, `${props.appName}-vpc`, {
      vpcName: `${props.appName}-vpc`,
      ipAddresses: ec2.IpAddresses.cidr("10.1.0.0/16"),
      maxAzs: 2,
      createInternetGateway: true,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: `${props.appName}-public-`,
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: `${props.appName}-private-isolated-`,
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
        {
          cidrMask: 24,
          name: `${props.appName}-private-egress-`,
          subnetType:
            ec2.SubnetType
              .PRIVATE_WITH_EGRESS /* no NAT Gateways - can use only vpc endpoints for internal communication */,
        },
      ],
      natGateways: 0,
      restrictDefaultSecurityGroup: true,
    });

    /* Tag the VPC */
    cdk.Tags.of(this.vpc).add("Name", `${props.appName}-vpc`);
  }
}
