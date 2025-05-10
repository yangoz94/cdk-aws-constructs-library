import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { IVpc } from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsManager from "aws-cdk-lib/aws-secretsmanager";
import { Duration } from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";

/**
 * Properties for configuring the AuroraServerlessV2Construct.
 */
export interface AuroraServerlessV2ConstructProps {
  /**
   * The application name to use as a prefix in resource names.
   */
  appName: string;

  /**
   * The environment tag (e.g., 'dev', 'staging', 'prod').
   */
  tagEnv: string;

  /**
   * The TCP port for the Aurora database (default: 5432 for PostgreSQL).
   */
  auroraPort: number;

  /**
   * The VPC where the Aurora database will be deployed.
   */
  vpc: IVpc;

  /**
   * Optional flag to create database credentials. If false, credentials will be loaded from Secrets Manager.
   */
  createCredentials?: boolean;

  /**
   * Optional database name. Defaults to `${appName}_${tagEnv}_aurora_db`.
   */
  databaseName?: string;
}

/**
 * Creates an Aurora Serverless v2 PostgreSQL database instance with proper security configuration.
 *
 * This construct deploys a cost-effective, auto-scaling Aurora Serverless v2 instance that
 * automatically scales based on workload. It handles proper networking, security groups,
 * encryption, and parameter configuration.
 *
 * Features:
 * - Serverless v2 with auto-scaling capabilities
 * - Multiple Availability Zone deployment for high availability
 * - Encrypted storage
 * - Performance insights enabled
 * - Configurable ACU range for cost optimization
 * - SSM parameters for endpoint discovery
 *
 * @example
 * const aurora = new AuroraServerlessV2Construct(this, 'Database', {
 *   appName: 'my-app',
 *   tagEnv: 'dev',
 *   auroraPort: 5432,
 *   vpc: myVpc,
 *   createCredentials: true
 * });
 */
export class AuroraServerlessV2Construct extends Construct {
  /**
   * The created Aurora database cluster.
   */
  public readonly dbCluster: rds.DatabaseCluster;

  /**
   * Secret containing database credentials.
   */
  public readonly dbCredentials: secretsManager.ISecret;

  /**
   * Constructs a new instance of the AuroraServerlessV2Construct.
   *
   * @param {Construct} scope - The parent construct, typically a CDK stack.
   * @param {string} id - The unique identifier for this construct.
   * @param {AuroraServerlessV2ConstructProps} props - Properties for configuring the Aurora database.
   */
  constructor(
    scope: Construct,
    id: string,
    props: AuroraServerlessV2ConstructProps
  ) {
    super(scope, id);

    /* Define Security Group for RDS */
    const rdsSecurityGroup = new ec2.SecurityGroup(
      this,
      `${props.appName}-${props.tagEnv}-aurora-sg`,
      {
        description: "Allow traffic to Aurora Serverless v2 instance",
        securityGroupName: `${props.appName}_${props.tagEnv}_aurora_sg`,
        vpc: props.vpc,
      }
    );

    /* Allow traffic from within the VPC */
    rdsSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(props.auroraPort),
      "Allow PostgreSQL traffic from within the VPC"
    );

    /* Determine if production environment for appropriate scaling and retention */
    const isProd = props.tagEnv === "prod";

    /* Set up database credentials either from existing secret or create new ones */
    if (props.createCredentials) {
      /* Create new credentials if specified */
      this.dbCredentials = new secretsManager.Secret(
        this,
        `${props.appName}-aurora-credentials`,
        {
          secretName: `${props.appName}-aurora-postgres-db-credentials`,
          description: `Credentials for ${props.appName} Aurora PostgreSQL database`,
          generateSecretString: {
            secretStringTemplate: JSON.stringify({ username: "postgres" }),
            generateStringKey: "password",
            excludePunctuation: true,
            excludeCharacters: "\"@/\\'",
          },
        }
      );
    } else {
      /* Use existing credentials from Secrets Manager */
      this.dbCredentials = secretsManager.Secret.fromSecretNameV2(
        this,
        `${props.appName}-aurora-postgres-db-credentials`,
        `${props.appName}-aurora-postgres-db-credentials`
      );
    }

    /* Aurora PostgreSQL engine version for Serverless V2 */
    const dbEngine = rds.DatabaseClusterEngine.auroraPostgres({
      version: rds.AuroraPostgresEngineVersion.VER_16_2,
    });

    /* Create the database name */
    const dbName =
      props.databaseName || `${props.appName}_${props.tagEnv}_aurora_db`;

    /* Create the Aurora Serverless v2 cluster */
    this.dbCluster = new rds.DatabaseCluster(
      this,
      `${props.appName}-${props.tagEnv}-aurora-db-cluster`,
      {
        backup: { retention: isProd ? Duration.days(30) : Duration.days(7) },
        clusterIdentifier: `${props.appName}-${props.tagEnv}-aurora-db-cluster`,
        credentials: rds.Credentials.fromSecret(this.dbCredentials),
        defaultDatabaseName: dbName,
        enableDataApi: true,
        engine: dbEngine,
        readers: [
          rds.ClusterInstance.serverlessV2(
            `${props.appName}-${props.tagEnv}-aurora-db-reader`,
            {
              scaleWithWriter: true,
              instanceIdentifier: `${props.appName}-${props.tagEnv}-reader`,
              enablePerformanceInsights: true,
            }
          ),
        ],
        removalPolicy: isProd
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
        securityGroups: [rdsSecurityGroup],
        serverlessV2MaxCapacity: isProd ? 8 : 4 /* Maximum ACUs */,
        serverlessV2MinCapacity: isProd ? 1 : 0.5 /* Minimum ACUs */,
        parameters: {
          max_parallel_workers: "16",
          max_parallel_workers_per_gather: "4",
          idle_in_transaction_session_timeout: "30000",
        },
        storageEncrypted: true,
        vpc: props.vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        writer: rds.ClusterInstance.serverlessV2(
          `${props.appName}-${props.tagEnv}-aurora-db-writer`,
          {
            instanceIdentifier: `${props.appName}-${props.tagEnv}-writer`,
            enablePerformanceInsights: true,
          }
        ),
      }
    );

    /* Create Aurora Writer Endpoint SSM Parameter */
    new StringParameter(this, `${props.appName}-aurora-writer-endpoint-ssm`, {
      parameterName: `/${props.appName}/aurora-writer-endpoint`,
      description: `${props.appName} Aurora Writer Instance Endpoint`,
      stringValue: this.dbCluster.clusterEndpoint.hostname,
    });

    /* Create Aurora Reader Endpoint SSM Parameter */
    new StringParameter(this, `${props.appName}-aurora-reader-endpoint-ssm`, {
      parameterName: `/${props.appName}/aurora-reader-endpoint`,
      description: `${props.appName} Aurora Reader Instance Endpoint`,
      stringValue: this.dbCluster.clusterReadEndpoint.hostname,
    });
  }
}
