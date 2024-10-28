import * as cdk from "aws-cdk-lib";
import { App, Stack } from "aws-cdk-lib";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { RemovalPolicy } from "aws-cdk-lib";
import { MultiServiceECSFargateLoadBalancedConstruct } from "./constructs/MultiServiceECSFargateLoadBalancedConstruct";
import { SingleServicePrivateECSFargateConstruct } from "./constructs/SingleServicePrivateECSFargateConstruct";
import { RetentionDays } from "aws-cdk-lib/aws-logs";

const app = new App();
const stack = new Stack(app, "MyStack");

/* Create a VPC for the ECS services */
const vpc = new Vpc(stack, "MyVpc", {
  maxAzs: 3, // Optional: Define the number of availability zones
});

/* Instantiate the MultiServiceECSFargateLoadBalancedConstruct */
new MultiServiceECSFargateLoadBalancedConstruct(
  stack,
  "MyMultiServiceConstruct",
  {
    appName: "my-app",
    tagEnv: "dev",
    vpc: vpc,
    hostedZoneId: "Z123456789ABCDEFG", // Replace with actual hosted zone ID
    domainName: "example.com",
    apiSubdomainName: "api",
    ecsServices: [
      {
        name: "auth-service",
        port: 8080,
        desiredCount: 2,
        version: "v1",
        envVariables: {
          NODE_ENV: "production",
          CUSTOM_ENV_VAR: "value", // Optional: Add any custom environment variables
        },
        priority: 1,
        image: {
          path: "src/containers/auth-service",
          name: "Dockerfile", // Optional: Specify a custom Dockerfile name
          labels: { service: "auth-service", version: "v1" }, // Optional: Add Docker labels
        },
        healthCheckConfig: {
          path: "/health",
          intervalSeconds: 20, // Optional: Specify the interval between health checks
          timeoutSeconds: 5, // Optional: Specify the timeout for health checks
          retries: 3, // Optional: Specify the number of retries before marking unhealthy
          startPeriodSeconds: 30, // Optional: Specify the warm-up period before health checks start
        },
        fargateConfig: {
          cpu: 512, // Optional: Define custom CPU units
          memoryLimitMiB: 1024, // Optional: Define custom memory limit
        },
        logGroupConfig: {
          logGroupName: "auth-service-log-group", // Optional: Custom log group name
          removalPolicy: RemovalPolicy.DESTROY, // Optional: Define removal policy
          retention: RetentionDays.ONE_WEEK, // Optional: Specify log retention period
        },
        autoScalingConfig: {
          minCapacity: 1, // Optional: Minimum number of tasks
          maxCapacity: 3, // Optional: Maximum number of tasks
          targetCpuUtilization: 70, // Optional: Target CPU utilization for scaling
          targetMemoryUtilization: 80, // Optional: Target memory utilization for scaling
        },
      },
      {
        name: "payment-service",
        port: 8081,
        desiredCount: 2,
        version: "v1",
        envVariables: {
          NODE_ENV: "production",
        },
        priority: 2,
        image: {
          path: "src/containers/payment-service",
        },
        healthCheckConfig: {
          path: "/health",
        },
      },
      
    ],
  }
);

/* Instantiate the SingleFargateServiceConstruct */
new SingleServicePrivateECSFargateConstruct(stack, "MySingleServiceConstruct", {
  appName: "my-single-service-app",
  tagEnv: "dev",
  vpc: vpc,
  service: {
    name: "user-service",
    port: 8080,
    desiredCount: 1,
    version: "v1",
    envVariables: {
      NODE_ENV: "production",
    },
    image: {
      path: "src/containers/user-service",
      name: "Dockerfile.user", // Optional: Specify a custom Dockerfile name
      labels: { service: "user-service", version: "v1" }, // Optional: Add Docker labels
    },
    healthCheckPath: "/health",
    fargateConfig: {
      cpu: 512, // Optional: Define custom CPU units
      memoryLimitMiB: 1024, // Optional: Define custom memory limit
    },
    logGroupConfig: {
      logGroupName: "user-service-log-group", // Optional: Custom log group name
      removalPolicy: RemovalPolicy.RETAIN, // Optional: Define removal policy
      retention: RetentionDays.TWO_WEEKS, // Optional: Specify log retention period
    },
  },
});

app.synth();
