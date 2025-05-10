import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";

/**
 * Properties for configuring the EC2BastionHostConstruct.
 */
export interface EC2BastionHostConstructProps extends cdk.StackProps {
  /**
   * The application name to use as a prefix in resource names.
   */
  appName: string;

  /**
   * The environment tag to apply to EC2 resources.
   */
  tagEnv: string;

  /**
   * The VPC where the bastion host will be deployed.
   */
  vpc: ec2.IVpc;
}

/**
 * Creates an EC2 bastion host for secure administrative access to resources within a VPC.
 *
 * This construct deploys an Amazon Linux 2023 ARM64 instance in a private subnet with
 * security groups configured for SSM Session Manager access. No public IP is assigned
 * to enhance security.
 *
 * The bastion host follows security best practices:
 * - Uses SSM for connection instead of SSH key pairs
 * - No public IP address
 * - IMDSv2 required (organization requirement)
 * - Restrictive security group rules
 * - Minimal IAM permissions
 *
 * @example
 * const bastionHost = new EC2BastionHostConstruct(this, 'BastionHost', {
 *   appName: 'my-app',
 *   tagEnv: 'production',
 *   vpc: myVpc,
 * });
 */
export class EC2BastionHostConstruct extends Construct {
  /**
   * The created EC2 instance resource.
   */
  public readonly ec2Instance: ec2.CfnInstance;

  /**
   * Constructs a new instance of the EC2BastionHostConstruct.
   *
   * @param {Construct} scope - The parent construct, typically a CDK stack.
   * @param {string} id - The unique identifier for this construct.
   * @param {EC2BastionHostConstructProps} props - Properties for configuring the EC2 bastion host.
   */
  constructor(
    scope: Construct,
    id: string,
    props: EC2BastionHostConstructProps
  ) {
    super(scope, id);

    /* Create EC2 Security Group with restricted permissions */
    const ec2SecurityGroup = new ec2.SecurityGroup(
      this,
      `${props.appName}-ec2-security-group`,
      {
        vpc: props.vpc,
        securityGroupName: `${props.appName}-ec2-security-group`,
      }
    );

    /* [CRITICAL] - Allow HTTPS traffic for SSM connectivity */
    ec2SecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow HTTPS traffic for SSM"
    );

    /* Allow all outbound connections for EC2 instance (can be restricted further) */
    ec2SecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.allTraffic());

    /* Define Amazon Linux 2023 ARM64 AMI for cost and performance optimization */
    const ami = new ec2.AmazonLinuxImage({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023,
      cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      edition: ec2.AmazonLinuxEdition.STANDARD,
    }).getImage(this).imageId;

    /* Create EC2 Launch Template with organization-required security settings */
    const ec2InstanceLaunchTemplate = new ec2.CfnLaunchTemplate(
      this,
      `${props.appName}-ec2-launch-template`,
      {
        launchTemplateData: {
          imageId: ami,
          instanceType: "t4g.micro",
          metadataOptions: {
            httpEndpoint: "enabled",
            httpPutResponseHopLimit: 1 /* Organization requirement 1: maximum of 1 hop */,
            httpTokens:
              "required" /* Organization requirement 2: require IMDSv2 */,
            instanceMetadataTags: "enabled",
          },
          networkInterfaces: [
            {
              associatePublicIpAddress:
                false /* Enhanced security: no public IP */,
              deviceIndex: 0,
              subnetId: props.vpc.privateSubnets[0].subnetId,
              groups: [ec2SecurityGroup.securityGroupId],
            },
          ],
          monitoring: {
            enabled: true,
          },
          tagSpecifications: [
            {
              resourceType: "instance",
              tags: [
                { key: "Name", value: `${props.appName}-bastion-host` },
                { key: "Environment", value: props.tagEnv },
                { key: "Role", value: "BastionHost" },
                { key: "Project", value: props.appName },
              ],
            },
          ],
        },
      }
    );

    /* Create IAM role with minimal permissions for SSM access */
    const ec2IamRole = new iam.Role(this, `${props.appName}-ec2-iam-role`, {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      roleName: `${props.appName}-ec2-iam-role`,
    });

    /* Attach SSM managed policy for Session Manager connectivity */
    ec2IamRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );

    /* Create instance profile to associate IAM role with EC2 */
    const instanceProfile = new iam.CfnInstanceProfile(
      this,
      `${props.appName}-instance-profile`,
      {
        roles: [ec2IamRole.roleName],
      }
    );

    /* Instantiate the EC2 instance using the launch template */
    this.ec2Instance = new ec2.CfnInstance(
      this,
      `${props.appName}-ec2-instance`,
      {
        iamInstanceProfile: instanceProfile.ref,
        launchTemplate: {
          launchTemplateId: ec2InstanceLaunchTemplate.ref,
          version: ec2InstanceLaunchTemplate.attrLatestVersionNumber,
        },
      }
    );
  }
}
