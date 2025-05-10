import * as cdk from "aws-cdk-lib";
import { StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";

interface OIDCRoleConstructProps extends StackProps {
  /** GitHub repository to allow for OIDC, formatted as "user/repo" or "org/repo". */
  githubRepoName: string;

  /** Application name to use as a prefix in resource names. */
  appName: string;
}

/**
 * Creates an OIDC provider and a GitHub OIDC role with specified permissions,
 * allowing GitHub Actions to assume necessary roles and manage AWS resources.
 *
 * @example
 * new OIDCAndExecutionRolesConstruct(this, 'OIDCAndExecutionRoles', {
 *   githubRepoName: 'my-org/my-repo',
 *   appName: 'my-app',
 *   env: { account: '123456789012', region: 'us-east-1' },
 * });
 */
export class OIDCRoleConstruct extends Construct {
  /**
   * Creates roles and permissions for GitHub Actions OIDC, enabling deployments
   * with access to specified AWS resources.
   *
   * @param {Construct} scope - The parent construct, typically a CDK stack.
   * @param {string} id - The unique identifier for this construct.
   * @param {OIDCRoleConstructProps} props - Properties for configuring the construct.
   */
  constructor(scope: Construct, id: string, props: OIDCRoleConstructProps) {
    super(scope, id);

    /* Set up the GitHub OIDC provider */
    const oidcProvider = new iam.OpenIdConnectProvider(this, `oidc-provider`, {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
      thumbprints: ["6938fd4d98bab03faadb97b34396831e3780aea1"],
    });

    /**
     * GitHub Actions OIDC Role: Allows GitHub Actions in the specified repository
     * to assume roles required for deployments.
     */
    const githubOidcRole = new iam.Role(this, `${props.appName}-github-oidc-role`, {
      assumedBy: new iam.WebIdentityPrincipal(oidcProvider.openIdConnectProviderArn, {
        StringLike: {
          "token.actions.githubusercontent.com:sub": `repo:${props.githubRepoName}:*`,
        },
      }),
      description: `${props.appName} GitHub Actions OIDC Role`,
      roleName: `${props.appName}-github-oidc-role`,
    });

    /**
     * Additional policies for the GitHub OIDC Role to allow necessary AWS actions
     * for deployments and access to specific AWS resources.
     */
    new iam.Policy(this, `${props.appName}-oidc-policy`, {
      policyName: `${props.appName}-oidc-policy`,
      statements: [
        new iam.PolicyStatement({
          sid: "AllowCDKDeployments",
          actions: ["sts:AssumeRole"],
          resources: [`arn:aws:iam::${cdk.Stack.of(this).account}:role/cdk-${props.appName}-*`],
        }),
        new iam.PolicyStatement({
          sid: "CloudFormationActions",
          actions: ["cloudformation:*"],
          resources: ["*"],
        }),
        new iam.PolicyStatement({
          sid: "S3BucketActions",
          actions: ["s3:*"],
          resources: [`arn:aws:s3:::${props.appName}-*`],
        }),
        new iam.PolicyStatement({
          sid: "SSMGet",
          actions: ["ssm:GetParameter"],
          resources: [
            `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/cdk-bootstrap/${
              props.appName
            }/version`,
          ],
        }),
        new iam.PolicyStatement({
          sid: "ReadEventSchemaRegistry",
          actions: [
            "schemas:DescribeRegistry",
            "schemas:ListSchemas",
            "schemas:SearchSchemas",
            "schemas:DescribeSchema",
            "schemas:ListSchemaVersions",
            "schemas:DescribeCodeBinding",
            "schemas:GetCodeBindingSource",
          ],
          resources: [
            `arn:aws:schemas:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:registry/*`,
            `arn:aws:schemas:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:schema/*`,
          ],
        }),
      ],
    }).attachToRole(githubOidcRole);
  }
}
