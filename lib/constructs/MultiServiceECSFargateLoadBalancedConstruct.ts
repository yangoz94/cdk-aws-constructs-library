import { NestedStack, NestedStackProps, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cdk from "aws-cdk-lib";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53_targets from "aws-cdk-lib/aws-route53-targets";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { AwsLogDriver } from "aws-cdk-lib/aws-ecs";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as z from "zod";

/**
 * Configuration for an individual ECS Fargate service.
 */
export interface ECSServiceConfig {
  /**
   * The name of the ECS service.
   * This name should be unique within the cluster.
   * @example 'auth-service'
   */
  name: string;

  /**
   * The port on which the service listens.
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
   * The priority of the ECS service when used with an Application Load Balancer listener.
   */
  priority: number;

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
   * Health check configuration for the ECS service.
   * @warning The health check will be performed on the path specified here with `curl`. Your dockerfile must install `curl` or a similar tool.
   * - `path`: The path for the health check endpoint of the ECS service.
   *   Must return a 200 status code to be considered healthy.
   *   @example '/health'
   * - `intervalSeconds`: The interval, in seconds, between health checks.
   *   @default 30
   * - `timeoutSeconds`: The time, in seconds, to wait for a response before timing out.
   *   @default 5
   * - `retries`: The number of retries allowed before marking the service unhealthy.
   *   @default 3
   * - `startPeriodSeconds`: The time, in seconds, to wait before starting health checks.
   *   @default 30
   */
  healthCheckConfig: {
    path: string;
    intervalSeconds?: number;
    timeoutSeconds?: number;
    retries?: number;
    startPeriodSeconds?: number;
  };

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

  /**
   * Optional auto-scaling configuration for the ECS service.
   * - `minCapacity`: The minimum number of tasks that should run.
   *   @example 1
   * - `maxCapacity`: The maximum number of tasks that should run.
   *   @example 5
   * - `targetCpuUtilization`: The target percentage of CPU utilization for scaling.
   *   @example 70
   * - `targetMemoryUtilization`: The target percentage of memory utilization for scaling.
   *   @example 80
   */
  autoScalingConfig?: {
    minCapacity: number;
    maxCapacity: number;
    targetCpuUtilization?: number;
    targetMemoryUtilization?: number;
  };
}

/**
 * Props for configuring a load-balanced ECS Fargate service construct.
 */
interface MultiServiceECSFargateLoadBalancedConstructProps
  extends cdk.StackProps {
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
   * The VPC is required to ensure networking is set up correctly for the ECS services.
   */
  vpc: ec2.IVpc;

  /**
   * The ID of the hosted zone in Route 53.
   * Used to create DNS records for the ECS services.
   * @example 'Z123456789ABCDEFG'
   */
  hostedZoneId: string;

  /**
   * The domain name associated with the hosted zone.
   * This is used to create an SSL certificate for the ECS services.
   * @example 'example.com'
   */
  domainName: string;

  /**
   * The subdomain for the API.
   * The service will be accessible at this subdomain (e.g., 'api.example.com').
   * @example 'api'
   */
  apiSubdomainName: string;

  /**
   * Configuration for the ECS services.
   */
  ecsServices: ECSServiceConfig[];
}

/* Zod schemas for validation */
const ECSServiceConfigSchema = z.object({
  name: z.string().min(1, "Each ECS service must have a name."),
  port: z.number().min(1).max(65535, "Port must be between 1 and 65535."),
  desiredCount: z.number().min(1, "desiredCount must be greater than 0."),
  version: z.string().min(1, "Version is required for each ECS service."),
  envVariables: z.record(z.string()),
  priority: z.number(),
  image: z.object({
    path: z.string().min(1, "Docker image path is required."),
    name: z.string().optional(),
    labels: z.record(z.string()).optional(),
  }),
  healthCheckConfig: z.object({
    path: z.string().min(1, "Health check path is required.").startsWith("/"),
    intervalSeconds: z.number().optional(),
    timeoutSeconds: z.number().optional(),
    retries: z.number().optional(),
    startPeriodSeconds: z.number().optional(),
  }),
  fargateConfig: z
    .object({
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
    })
    .optional(),
  logGroupConfig: z
    .object({
      logGroupName: z.string().min(1, "Log group name is required."),
      removalPolicy: z.nativeEnum(RemovalPolicy),
      retention: z.nativeEnum(RetentionDays),
    })
    .optional(),
  autoScalingConfig: z
    .object({
      minCapacity: z.number().min(1, "Minimum capacity must be at least 1."),
      maxCapacity: z.number().min(1, "Maximum capacity must be at least 1."),
      targetCpuUtilization: z.number().min(1).max(100).optional(),
      targetMemoryUtilization: z.number().min(1).max(100).optional(),
    })
    .optional(),
});

const MultiServiceECSFargateLoadBalancedConstructPropsSchema = z.object({
  appName: z.string().min(3, "appName must be at least 3 characters."),
  tagEnv: z.string().min(1, "tagEnv is required and cannot be empty."),
  vpc: z.instanceof(ec2.Vpc).refine((vpc) => !!vpc, "VPC is required."),
  hostedZoneId: z.string().min(1, "hostedZoneId is required."),
  domainName: z.string().min(1, "domainName is required."),
  apiSubdomainName: z.string().min(1, "apiSubdomainName is required."),
  ecsServices: z
    .array(ECSServiceConfigSchema)
    .min(1, "At least one ECS service configuration is required."),
});

export class MultiServiceECSFargateLoadBalancedConstruct extends Construct {
  public readonly ARecord: route53.ARecord;
  public readonly certificate: acm.Certificate;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly loadBalancerhttpsListener: elbv2.ApplicationListener;
  public readonly cluster: ecs.Cluster;
  public readonly services: ecs.FargateService[] = [];
  public readonly taskDefinitions: ecs.FargateTaskDefinition[] = [];
  constructor(
    scope: Construct,
    id: string,
    props: MultiServiceECSFargateLoadBalancedConstructProps
  ) {
    super(scope, id);

    try {
      /* Validate props using zod schema */
      MultiServiceECSFargateLoadBalancedConstructPropsSchema.parse(props);
    } catch (error) {
      console.error("Validation error:", error);
      throw new Error(
        "Invalid input properties for MultiServiceECSFargateLoadBalancedConstruct."
      );
    }

    const region = cdk.Stack.of(this).region;

    /* Lookup the hosted zone */
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      `${props.appName}-hosted-zone-lookup`,
      {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.domainName,
      }
    );

    /* Create a Wild Card Certificate for the Load Balancer */
    this.certificate = new acm.Certificate(
      this,
      `${props.appName}-ssl-certificate`,
      {
        domainName: `*.${props.tagEnv}.${props.domainName}`,
        validation: acm.CertificateValidation.fromDns(hostedZone),
        subjectAlternativeNames: [
          `${props.apiSubdomainName}.${props.domainName}`,
        ],
      }
    );

    /* Instantiate the ECS cluster */
    this.cluster = new ecs.Cluster(this, `${props.appName}-cluster`, {
      vpc: props.vpc,
      clusterName: `${props.appName}-cluster`,
    });

    /* Create the Application Load Balancer */
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      `${props.appName}-${props.tagEnv}-load-balancer`,
      {
        vpc: props.vpc,
        internetFacing: true,
        loadBalancerName: `${props.appName}-${props.tagEnv}-load-balancer`,
        vpcSubnets: {
          subnets: props.vpc.selectSubnets({
            onePerAz: true,
            subnetType: ec2.SubnetType.PUBLIC,
          }).subnets,
        },
      }
    );

    /* Add Alias A record to the load balancer */
    this.ARecord = new route53.ARecord(
      this,
      `${props.appName}-alias-record-${region}`,
      {
        zone: hostedZone,
        target: route53.RecordTarget.fromAlias(
          new route53_targets.LoadBalancerTarget(this.loadBalancer)
        ),
        recordName: `${props.apiSubdomainName}.${props.domainName}`,
      }
    );

    /* Add load balancer arn to SSM parameter store */
    new StringParameter(this, `${props.appName}-${region}-load-balancer-arn`, {
      parameterName: `/${props.appName}/load-balancer-arn`,
      stringValue: this.loadBalancer.loadBalancerArn,
    });

    /* Add load balancer security group id to SSM parameter store */
    new StringParameter(
      this,
      `${props.appName}-${region}-load-balancer-security-group-id`,
      {
        parameterName: `/${props.appName}/load-balancer-security-group-id`,
        stringValue:
          this.loadBalancer.connections.securityGroups[0].securityGroupId,
      }
    );

    /* Add Name tag to the load balancer */
    cdk.Tags.of(this.loadBalancer).add(
      "name",
      `${props.appName}-load-balancer`
    );

    /* Create a listener for the load balancer */
    this.loadBalancerhttpsListener = this.loadBalancer.addListener(
      `${props.appName}-https-listener`,
      {
        port: 443,
        certificates: [this.certificate],
        sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
        defaultAction: elbv2.ListenerAction.fixedResponse(404, {
          contentType: "application/json",
          messageBody: JSON.stringify({ message: "Not Found" }),
        }),
      }
    );

    /* Create a listener rule for HTTP port 80 to HTTPS port 443 redirection */
    this.loadBalancer.addListener(`${props.appName}-http-listener`, {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: "HTTPS",
        port: "443",
      }),
    });

    /* Create the ECS services */
    for (const ecsService of props.ecsServices) {
      const taskDefinition = new ecs.FargateTaskDefinition(
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
      const containerImage = ecs.ContainerImage.fromAsset(
        ecsService.image.path,
        {
          file: ecsService.image.name || "Dockerfile",
          platform: Platform.LINUX_ARM64,
        }
      );

      /* Inject the environment variables */
      const environmentVariables = {
        PORT: `${ecsService.port}`,
        SERVICE_NAME: ecsService.name,
        API_VERSION: ecsService.version,
        ...ecsService.envVariables,
      };

      /* Extract health check configuration */
      const healthCheckConfig = ecsService.healthCheckConfig;
      const healthCheckPath = healthCheckConfig.path;
      const intervalSeconds = healthCheckConfig.intervalSeconds || 30;
      const timeoutSeconds = healthCheckConfig.timeoutSeconds || 5;
      const retries = healthCheckConfig.retries || 3;
      const startPeriodSeconds = healthCheckConfig.startPeriodSeconds || 30;

      /* Add the container to the task definition */
      taskDefinition.addContainer(`${ecsService.name}-container`, {
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
            `curl -f http://localhost:${ecsService.port}${healthCheckPath} || exit 1`,
          ],
          interval: cdk.Duration.seconds(intervalSeconds),
          timeout: cdk.Duration.seconds(timeoutSeconds),
          retries,
          startPeriod: cdk.Duration.seconds(startPeriodSeconds),
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

      /* Add ingress rule to the security group of the ECS service */
      ecsSecurityGroup.addIngressRule(
        this.loadBalancer.connections.securityGroups[0],
        ec2.Port.tcp(ecsService.port),
        "Allow traffic from the load balancer"
      );

      /* Instantiate the ECS service */
      const service = new ecs.FargateService(
        this,
        `${props.appName}-${ecsService.name}-service`,
        {
          assignPublicIp: true,
          cluster: this.cluster,
          desiredCount: ecsService.desiredCount,
          securityGroups: [ecsSecurityGroup],
          serviceName: ecsService.name,
          taskDefinition: taskDefinition,
          vpcSubnets: {
            subnets: props.vpc.selectSubnets({
              onePerAz: true,
              subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            }).subnets,
          },
        }
      );

      /* Add the target group to the listener */
      this.loadBalancerhttpsListener.addTargets(
        `${props.appName}-${ecsService.name}-tg`,
        {
          port: ecsService.port,
          targets: [service],
          targetGroupName: `${props.appName}-${ecsService.name}-tg`,
          protocol: elbv2.ApplicationProtocol.HTTP,
          conditions: [
            elbv2.ListenerCondition.pathPatterns([
              `/${ecsService.name}/${ecsService.version}/*`,
            ]),
          ],
          healthCheck: {
            path: healthCheckPath,
            interval: cdk.Duration.seconds(intervalSeconds),
            timeout: cdk.Duration.seconds(timeoutSeconds),
            healthyHttpCodes: "200-299",
          },
          priority: ecsService.priority,
        }
      );

      /* Add service to the services array for easy access outside the construct */
      this.services.push(service);

      /* Add task definition to the taskDefinitions array for easy access outside the construct */
      this.taskDefinitions.push(taskDefinition);

      /* Optional AutoScaling */
      if (ecsService.autoScalingConfig) {
        const scalableTarget = service.autoScaleTaskCount({
          minCapacity: ecsService.autoScalingConfig.minCapacity,
          maxCapacity: ecsService.autoScalingConfig.maxCapacity,
        });

        if (ecsService.autoScalingConfig.targetCpuUtilization) {
          scalableTarget.scaleOnCpuUtilization(
            `${props.appName}-${ecsService.name}-cpu-scaling`,
            {
              targetUtilizationPercent:
                ecsService.autoScalingConfig.targetCpuUtilization,
            }
          );
        }

        if (ecsService.autoScalingConfig.targetMemoryUtilization) {
          scalableTarget.scaleOnMemoryUtilization(
            `${props.appName}-${ecsService.name}-memory-scaling`,
            {
              targetUtilizationPercent:
                ecsService.autoScalingConfig.targetMemoryUtilization,
            }
          );
        }
      }

      /* Add tags for better tracking */
      cdk.Tags.of(service).add("AppName", props.appName);
      cdk.Tags.of(service).add("Environment", props.tagEnv);
      cdk.Tags.of(service).add("ServiceName", ecsService.name);
    }
  }
}
