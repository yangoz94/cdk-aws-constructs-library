import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cdk from "aws-cdk-lib";
import { RemovalPolicy } from "aws-cdk-lib";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { AwsLogDriver } from "aws-cdk-lib/aws-ecs";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import z from "zod/lib";

/**
 * Props for configuring a single ECS Fargate service construct.
 */
export interface SingleServicePrivateECSFargateConstructProps extends cdk.StackProps {
  /**
   * The name of the application.
   * Must be at least 3 characters long.
   * @example 'my-app'
   */
  appName: string;

  /**
   * The environment tag for the deployment (e.g., 'dev', 'prod').
   * @example 'dev'
   */
  tagEnv: string;

  /**
   * The VPC in which the ECS cluster will be deployed.
   * The VPC is required to ensure networking is set up correctly for the ECS service.
   */
  vpc: ec2.IVpc;

  /**
   * Configuration for the ECS service.
   */
  service: {
    /**
     * The name of the ECS service.
     * This name should be unique within the cluster.
     * @example 'auth-service'
     */
    name: string;

    /**
     * The port on which the service listens.
     * The service should be configured to listen on this port inside the container.
     * Must be between 1 and 65535.
     * @example 8080
     */
    port: number;

    /**
     * The desired number of tasks to run for the ECS service.
     * @example 2
     */
    desiredCount: number;

    /**
     * The version of the service or application.
     * This helps in differentiating between deployments.
     * @example 'v1'
     */
    version: string;

    /**
     * Environment variables to be set in the ECS container.
     * The following are automatically injected:
     * - `PORT`
     * - `SERVICE_NAME`
     * - `API_VERSION`
     * @example { NODE_ENV: 'production' }
     */
    envVariables: { [key: string]: string };

    /**
     * The Docker image configuration for the ECS service.
     * - `path`: The path to the Dockerfile or directory for the Docker image.
     *   @example 'src/containers/auth-service'
     * - `name`: The name of the Dockerfile.
     *   @example 'Dockerfile' or 'Dockerfile.auth.service'
     *   @default 'Dockerfile'
     * - `labels`: Optional labels to apply to the Docker image.
     *   @example { cluster: 'my-cluster', service: 'auth-service', version: 'v1' }
     */
    image: {
      path: string;
      name?: string;
      labels?: { [key: string]: string };
    };

    /**
     * The path for the health check endpoint of the ECS service.
     * The endpoint must return a 200 status code to be considered healthy.
     * @example '/health'
     */
    healthCheckPath: string;

    /**
     * Optional Fargate configuration for the service.
     * - `cpu`: The number of CPU units used by the task.
     *   @warning This value must be compatible with the memory value. Check the AWS documentation for more information.
     *   @see https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#cpu
     *   @default 512
     * - `memoryLimitMiB`: The amount of memory (in MiB) used by the task.
     *   @warning This value must be compatible with the CPU value. Check the AWS documentation for more information.
     *   @see https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#memory
     *   @default 1024
     */
    fargateConfig?: {
      cpu?: ecs.FargateTaskDefinitionProps["cpu"];
      memoryLimitMiB?: ecs.FargateTaskDefinitionProps["memoryLimitMiB"];
    };

    /**
     * Optional configuration for the log group associated with the ECS service.
     * - `logGroupName`: The name of the log group.
     *   @example 'auth-service-log-group'
     *   @default `${serviceName}-log-group`
     * - `removalPolicy`: Defines the removal policy for the log group.
     *   @default `RemovalPolicy.DESTROY`
     * - `retention`: The number of days to retain the logs.
     *   @default `RetentionDays.TWO_WEEKS`
     */
    logGroupConfig?: {
      logGroupName: string;
      removalPolicy: RemovalPolicy;
      retention: RetentionDays;
    };
  };
}

/* Zod schemas for validation */
const ECSFargateConfigSchema = z.object({
  cpu: z
    .union([
      z.literal(256),
      z.literal(512),
      z.literal(1024),
      z.literal(2048),
      z.literal(4096),
    ])
    .optional(),
  memoryLimitMiB: z
    .union([
      z.literal(512),
      z.literal(1024),
      z.literal(2048),
      z.literal(3072),
      z.literal(4096),
      z.literal(5120),
      z.literal(6144),
      z.literal(7168),
      z.literal(8192),
      z.literal(16384),
      z.literal(30720),
    ])
    .optional(),
});

const ECSImageObjectSchema = z.object({
  path: z.string().min(1, "Docker image path is required."),
  name: z.string().optional(),
  labels: z.record(z.string()).optional(),
});

const ECSLogGroupConfigSchema = z.object({
  logGroupName: z.string().min(1, "Log group name is required."),
  removalPolicy: z.nativeEnum(RemovalPolicy),
  retention: z.nativeEnum(RetentionDays),
});

const ECSServicePropsSchema = z.object({
  name: z.string().min(1, "Each ECS service must have a name."),
  port: z.number().min(1).max(65535, "Port must be between 1 and 65535."),
  desiredCount: z.number().min(1, "desiredCount must be greater than 0."),
  version: z.string().min(1, "Version is required for the ECS service."),
  envVariables: z.record(z.string()),
  image: ECSImageObjectSchema,
  //health check path must start with /
  healthCheckPath: z
    .string()
    .min(1, "Health check path is required.")
    .startsWith("/"),
  fargateConfig: ECSFargateConfigSchema.optional(),
  logGroupConfig: ECSLogGroupConfigSchema.optional(),
});

const SingleServicePrivateECSFargateConstructPropsSchema = z.object({
  appName: z.string().min(3, "appName must be at least 3 characters."),
  tagEnv: z.string().min(1, "tagEnv is required and cannot be empty."),
  vpc: z.instanceof(ec2.Vpc).refine((vpc) => !!vpc, "VPC is required."),
  service: ECSServicePropsSchema,
});

export class SingleServicePrivateECSFargateConstruct extends Construct {
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;
  public readonly taskDefinition: ecs.FargateTaskDefinition;

  constructor(
    scope: Construct,
    id: string,
    props: SingleServicePrivateECSFargateConstructProps
  ) {
    super(scope, id);

    /* Validate props using zod schema */
    SingleServicePrivateECSFargateConstructPropsSchema.parse(props);

    const ecsService = props.service;

    /* Instantiate the ECS cluster */
    this.cluster = new ecs.Cluster(this, `${props.appName}-cluster`, {
      vpc: props.vpc,
      clusterName: `${props.appName}-cluster`,
    });

    /* Validate ECS service using zod schema */
    ECSServicePropsSchema.parse(ecsService);

    /* Create the ECS task definition */
    this.taskDefinition = new ecs.FargateTaskDefinition(
      this,
      `${ecsService.name}-task-definition`,
      {
        memoryLimitMiB: ecsService.fargateConfig?.memoryLimitMiB || 1024,
        cpu: ecsService.fargateConfig?.cpu || 512,
        family: `${ecsService.name}-task-family`,
        runtimePlatform: {
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
        },
      }
    );

    /* Instantiate the log group */
    const logGroup = new LogGroup(
      this,
      `${ecsService.name}-log-group`,
      ecsService.logGroupConfig || {
        logGroupName: `${ecsService.name}-log-group`,
        removalPolicy: RemovalPolicy.DESTROY,
        retention: RetentionDays.TWO_WEEKS,
      }
    );

    /* Instantiate the log driver */
    const logDriver = new AwsLogDriver({
      logGroup: logGroup,
      streamPrefix: `${ecsService.name}`,
    });

    /* Instantiate the container image */
    const containerImage = ecs.ContainerImage.fromAsset(ecsService.image.path, {
      file: ecsService.image.name || "Dockerfile",
      platform: Platform.LINUX_ARM64,
    });

    /* Inject the environment variables */
    const environmentVariables = {
      PORT: `${ecsService.port}`,
      SERVICE_NAME: ecsService.name,
      API_VERSION: ecsService.version,
      ...ecsService.envVariables,
    };

    /* Add the container to the task definition */
    this.taskDefinition.addContainer(`${ecsService.name}-container`, {
      containerName: `${ecsService.name}-container`,
      image: containerImage,
      environment: environmentVariables,
      logging: logDriver,
      portMappings: [{ containerPort: ecsService.port }],
      dockerLabels: ecsService.image.labels || {
        cluster: this.cluster.clusterName,
        service: ecsService.name,
        version: ecsService.version,
      },
      healthCheck: {
        command: [
          "CMD-SHELL",
          `curl -f http://localhost:${ecsService.port}${ecsService.healthCheckPath} || exit 1`,
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(30),
      },
    });

    /* Create a security group for the ECS service */
    const ecsSecurityGroup = new ec2.SecurityGroup(
      this,
      `${ecsService.name}-security-group`,
      {
        allowAllOutbound: true,
        description: `Security group for the ECS service ${ecsService.name}`,
        vpc: props.vpc,
      }
    );

    /* Allow inbound traffic from other resources in the VPC to the service's port */
    ecsSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(ecsService.port),
      `Allow inbound traffic on port ${ecsService.port} from within the VPC`
    );

    /* Instantiate the ECS Fargate service */
    this.service = new ecs.FargateService(
      this,
      `${props.appName}-${ecsService.name}-service`,
      {
        assignPublicIp: false,
        cluster: this.cluster,
        desiredCount: ecsService.desiredCount,
        securityGroups: [ecsSecurityGroup],
        serviceName: ecsService.name,
        taskDefinition: this.taskDefinition,
        vpcSubnets: {
          subnets: props.vpc.selectSubnets({
            onePerAz: true,
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          }).subnets,
        },
      }
    );
  }
}
