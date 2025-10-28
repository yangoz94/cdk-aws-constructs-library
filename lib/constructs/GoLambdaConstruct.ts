import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sns_subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatch_actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as fs from "fs";
import * as path from "path";
import { Duration } from "aws-cdk-lib";

/**
 * Defines API Gateway integration details.
 */
export interface ApiGwIntegrationProps {
  /**
   * The API Gateway instance to attach this Lambda function to.
   */
  apiGateway: apigateway.RestApi;

  /**
   * The API route to be associated with the Lambda function.
   */
  route: string;

  /**
   * The HTTP method for the API route.
   */
  method: APIMethodsEnum;

  /**
   * Whether the API route should be protected by an API Gateway authorizer.
   */
  isProtected?: boolean;

  /**
   * Optional API Gateway authorizer for protected routes.
   * Required if isProtected is true.
   */
  authorizer?: apigateway.IAuthorizer;

  /**
   * Enable CORS for this route (default: false).
   */
  enableCors?: boolean;

  /**
   * CORS configuration options.
   */
  corsOptions?: apigateway.CorsOptions;
}

/**
 * Enum for API Gateway HTTP methods.
 */
export enum APIMethodsEnum {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
  PATCH = "PATCH",
  OPTIONS = "OPTIONS",
}

/**
 * Enum for DynamoDB permissions.
 */
export enum DynamoDBPermissions {
  /* Read Operations */
  QUERY = "dynamodb:Query",
  SCAN = "dynamodb:Scan",
  GET_ITEM = "dynamodb:GetItem",
  BATCH_GET_ITEM = "dynamodb:BatchGetItem",
  DESCRIBE_TABLE = "dynamodb:DescribeTable",
  LIST_TABLES = "dynamodb:ListTables",

  /* Write Operations */
  PUT_ITEM = "dynamodb:PutItem",
  UPDATE_ITEM = "dynamodb:UpdateItem",
  DELETE_ITEM = "dynamodb:DeleteItem",
  BATCH_WRITE_ITEM = "dynamodb:BatchWriteItem",
  CREATE_TABLE = "dynamodb:CreateTable",
  UPDATE_TABLE = "dynamodb:UpdateTable",
  DELETE_TABLE = "dynamodb:DeleteTable",
}

/**
 * Enum for S3 permissions.
 */
export enum S3Permissions {
  GET_OBJECT = "s3:GetObject",
  PUT_OBJECT = "s3:PutObject",
  DELETE_OBJECT = "s3:DeleteObject",
  LIST_BUCKET = "s3:ListBucket",
  GET_BUCKET_LOCATION = "s3:GetBucketLocation",
  GET_BUCKET_VERSIONING = "s3:GetBucketVersioning",
  GET_OBJECT_VERSION = "s3:GetObjectVersion",
  DELETE_OBJECT_VERSION = "s3:DeleteObjectVersion",
}

/**
 * Enum for SQS permissions.
 */
export enum SQSPermissions {
  SEND_MESSAGE = "sqs:SendMessage",
  RECEIVE_MESSAGE = "sqs:ReceiveMessage",
  DELETE_MESSAGE = "sqs:DeleteMessage",
  GET_QUEUE_ATTRIBUTES = "sqs:GetQueueAttributes",
  LIST_QUEUES = "sqs:ListQueues",
  PURGE_QUEUE = "sqs:PurgeQueue",
}

/**
 * Enum for SNS permissions.
 */
export enum SNSPermissions {
  PUBLISH = "sns:Publish",
  SUBSCRIBE = "sns:Subscribe",
  UNSUBSCRIBE = "sns:Unsubscribe",
  LIST_TOPICS = "sns:ListTopics",
  GET_TOPIC_ATTRIBUTES = "sns:GetTopicAttributes",
}

/**
 * Enum for KMS permissions.
 */
export enum KMSPermissions {
  ENCRYPT = "kms:Encrypt",
  DECRYPT = "kms:Decrypt",
  GENERATE_DATA_KEY = "kms:GenerateDataKey",
  DESCRIBE_KEY = "kms:DescribeKey",
  RE_ENCRYPT = "kms:ReEncrypt",
}

/**
 * Properties for configuring the GoLambdaConstruct.
 */
export interface GoLambdaConstructProps {
  /**
   * The application name used as a prefix in resource names.
   */
  appName: string;

  /**
   * The name for the Lambda function.
   */
  lambdaName: string;

  /**
   * The VPC where the Lambda function will be deployed.
   */
  vpc: ec2.IVpc;

  /**
   * The VPC subnets for the Lambda function.
   */
  vpcSubnets: ec2.SubnetSelection;

  /**
   * The directory path to the Go binary for the Lambda function.
   * For Runtime.PROVIDED_AL2, this should be a folder containing an executable named 'bootstrap'
   * or a zip file containing the bootstrap executable.
   */
  binaryPath: string;

  /**
   * The handler name for the Lambda function (default: 'bootstrap').
   * For Go with PROVIDED_AL2 runtime, this should typically be 'bootstrap'.
   */
  handler?: string;

  /**
   * The Lambda runtime (default: PROVIDED_AL2 for Go).
   */
  runtime?: lambda.Runtime;

  /**
   * The Lambda architecture (default: ARM_64 for better performance and cost).
   */
  architecture?: lambda.Architecture;

  /**
   * Security groups for the Lambda function (optional).
   * If not provided, CDK will create a default security group.
   */
  securityGroups?: ec2.ISecurityGroup[];

  /**
   * The timeout for the Lambda function (default: 30 seconds).
   */
  timeout?: Duration;

  /**
   * The memory size for the Lambda function (default: 512 MB).
   */
  memorySize?: number;

  /**
   * The maximum number of times the Lambda function can be retried on failure (default: 2).
   */
  maxRetryAttempts?: number;

  /**
   * The maximum number of concurrent executions (default: 1000).
   * Maps to reservedConcurrentExecutions on the Lambda function.
   * WARNING: Setting to 0 or negative values blocks all invocations.
   * Only positive values are applied. Omit this property for unlimited concurrency.
   * Note: This is different from SQS event source concurrency (sqsEventSource.maxConcurrency).
   */
  maxConcurrency?: number;

  /**
   * DynamoDB permissions for the Lambda function (optional).
   */
  dynamoDbPermissions?: DynamoDBPermissions[];

  /**
   * DynamoDB tables to grant access to (optional).
   */
  dynamoDbTables?: dynamodb.ITable[];

  /**
   * S3 permissions for the Lambda function (optional).
   */
  s3Permissions?: S3Permissions[];

  /**
   * S3 buckets to grant access to (optional).
   */
  s3Buckets?: s3.IBucket[];

  /**
   * SQS permissions for the Lambda function (optional).
   */
  sqsPermissions?: SQSPermissions[];

  /**
   * SQS queues to grant access to (optional).
   */
  sqsQueues?: sqs.IQueue[];

  /**
   * SNS permissions for the Lambda function (optional).
   */
  snsPermissions?: SNSPermissions[];

  /**
   * SNS topics to grant access to (optional).
   */
  snsTopics?: sns.ITopic[];

  /**
   * KMS permissions for the Lambda function (optional).
   */
  kmsPermissions?: KMSPermissions[];

  /**
   * KMS keys to grant access to (optional).
   */
  kmsKeys?: kms.IKey[];

  /**
   * VPC endpoints that the Lambda function can access (optional).
   */
  vpcEndpoints?: (ec2.InterfaceVpcEndpoint | ec2.GatewayVpcEndpoint)[];

  /**
   * Lambda layers to include in the Lambda function (optional).
   */
  layers?: lambda.ILayerVersion[];

  /**
   * Environment variables to pass to the Lambda function (optional).
   */
  envVariables?: { [key: string]: string };

  /**
   * Log retention period in days (default: 14).
   */
  logRetention?: logs.RetentionDays;

  /**
   * Enable X-Ray tracing (default: true).
   */
  enableTracing?: boolean;

  /**
   * The description for the Lambda function (default: auto-generated).
   */
  description?: string;

  /**
   * The function name override (default: auto-generated from appName and lambdaName).
   */
  functionName?: string;

  /**
   * Dead letter queue for failed invocations (optional).
   */
  deadLetterQueue?: sqs.IQueue;

  /**
   * Reserved concurrency for the Lambda function (optional).
   * WARNING: Setting to 0 or negative values blocks all invocations.
   * Only positive values are applied. Omit for unlimited concurrency.
   */
  reservedConcurrency?: number;

  /**
   * Provisioned concurrency for the Lambda function (optional).
   * This creates a version and alias with provisioned concurrency.
   */
  provisionedConcurrency?: number;

  /**
   * CloudWatch alarms configuration (optional).
   */
  alarms?: {
    /**
     * Enable error rate alarm (default: true).
     */
    enableErrorRateAlarm?: boolean;
    /**
     * Enable duration alarm (default: true).
     */
    enableDurationAlarm?: boolean;
    /**
     * Enable throttles alarm (default: true).
     */
    enableThrottlesAlarm?: boolean;
    /**
     * Enable dead letter queue depth alarm (default: true, if DLQ is provided).
     */
    enableDlqDepthAlarm?: boolean;
    /**
     * SNS topic for alarm notifications (optional).
     */
    alarmTopic?: sns.ITopic;
    /**
     * Error rate alarm threshold (default: 1).
     */
    errorRateThreshold?: number;
    /**
     * Duration alarm threshold as percentage of timeout (default: 0.8 = 80%).
     */
    durationThresholdPercentage?: number;
    /**
     * Throttles alarm threshold (default: 1).
     */
    throttlesThreshold?: number;
    /**
     * DLQ depth alarm threshold (default: 1).
     */
    dlqDepthThreshold?: number;
    /**
     * Alarm evaluation periods (default: 2 for most alarms, 1 for throttles/DLQ).
     */
    evaluationPeriods?: number;
    /**
     * Alarm period for metrics (default: 5 minutes).
     */
    alarmPeriod?: Duration;
  };

  /**
   * Optional API Gateway integration settings.
   */
  apiGwIntegration?: ApiGwIntegrationProps;

  /**
   * SQS event source configuration (optional).
   */
  sqsEventSource?: {
    /**
     * The SQS queue to use as an event source.
     */
    queue: sqs.IQueue;
    /**
     * The maximum number of records to process in a single batch (default: 10).
     */
    batchSize?: number;
    /**
     * The maximum time to wait for records before processing (default: 20 seconds).
     */
    maxBatchingWindow?: Duration;
    /**
     * The maximum number of concurrent batches to process (default: 1).
     * This is different from the Lambda function's reservedConcurrentExecutions (maxConcurrency prop).
     */
    maxConcurrency?: number;
    /**
     * Enable partial batch failure reporting (default: true).
     */
    reportBatchItemFailures?: boolean;
  };

  /**
   * SNS event source configuration (optional).
   */
  snsEventSource?: {
    /**
     * The SNS topic to use as an event source.
     */
    topic: sns.ITopic;
    /**
     * The filter policy for SNS messages (optional).
     */
    filterPolicy?: { [attribute: string]: sns.SubscriptionFilter };
  };

  /**
   * Custom IAM policy statements (optional).
   */
  customPolicyStatements?: iam.PolicyStatement[];
}

/**
 * Creates a Go Lambda function with comprehensive AWS service integrations.
 *
 * This construct supports integration with DynamoDB, S3, SQS, SNS, KMS, and API Gateway.
 * It automatically handles IAM permissions based on the provided service integrations.
 *
 * @example
 * // Example: Using Go Lambda with DynamoDB and S3
 * const goLambda = new GoLambdaConstruct(this, 'GoApiLambda', {
 *   appName: 'myApp',
 *   lambdaName: 'myGoApiLambda',
 *   vpc: myVpc,
 *   vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
 *   binaryPath: 'dist/main',
 *   handler: 'bootstrap', // Optional: defaults to 'bootstrap'
 *   runtime: lambda.Runtime.PROVIDED_AL2, // Optional: defaults to PROVIDED_AL2
 *   architecture: lambda.Architecture.ARM_64, // Optional: defaults to ARM_64
 *   memorySize: 1024, // Optional: defaults to 512
 *   timeout: Duration.minutes(5), // Optional: defaults to 30 seconds
 *   maxRetryAttempts: 3, // Optional: defaults to 2
 *   enableTracing: true, // Optional: defaults to true
 *   description: 'Custom API Lambda function', // Optional: auto-generated if not provided
 *   dynamoDbPermissions: [DynamoDBPermissions.QUERY, DynamoDBPermissions.PUT_ITEM],
 *   dynamoDbTables: [myTable],
 *   s3Permissions: [S3Permissions.GET_OBJECT, S3Permissions.PUT_OBJECT],
 *   s3Buckets: [myBucket],
 *   apiGwIntegration: {
 *     apiGateway: myRestApi,
 *     route: '/api/data',
 *     method: APIMethodsEnum.POST,
 *     isProtected: true,
 *     authorizer: myAuthorizer,
 *     enableCors: true,
 *   },
 *   alarms: {
 *     enableErrorRateAlarm: true,
 *     enableDurationAlarm: true,
 *     errorRateThreshold: 5, // Optional: defaults to 1
 *     durationThresholdPercentage: 0.9, // Optional: defaults to 0.8 (80%)
 *     alarmPeriod: Duration.minutes(1), // Optional: defaults to 5 minutes
 *     alarmTopic: myAlarmTopic,
 *   },
 * });
 *
 * @example
 * // Example: Using Go Lambda for SQS processing
 * const goSqsLambda = new GoLambdaConstruct(this, 'GoSqsLambda', {
 *   appName: 'myApp',
 *   lambdaName: 'myGoSqsLambda',
 *   vpc: myVpc,
 *   vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
 *   binaryPath: 'dist/sqs-handler',
 *   sqsPermissions: [SQSPermissions.RECEIVE_MESSAGE, SQSPermissions.DELETE_MESSAGE],
 *   sqsQueues: [myQueue],
 *   timeout: Duration.minutes(5),
 *   maxConcurrency: 10, // New: replaces reservedConcurrency
 *   deadLetterQueue: myDlq,
 *   alarms: {
 *     enableDlqDepthAlarm: true,
 *     dlqDepthThreshold: 5, // Alert when 5+ messages in DLQ
 *     alarmTopic: myAlarmTopic,
 *   },
 * });
 *
 * @example
 * // Example: Advanced configuration with custom settings
 * const advancedLambda = new GoLambdaConstruct(this, 'AdvancedLambda', {
 *   appName: 'myApp',
 *   lambdaName: 'advancedLambda',
 *   vpc: myVpc,
 *   vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
 *   binaryPath: 'dist/advanced-handler',
 *   functionName: 'custom-function-name', // Override auto-generated name
 *   handler: 'custom-handler', // Custom handler name
 *   runtime: lambda.Runtime.PROVIDED_AL2, // Explicit runtime
 *   architecture: lambda.Architecture.X86_64, // Use x86_64 instead of ARM64
 *   memorySize: 2048, // 2GB memory
 *   timeout: Duration.minutes(15), // 15 minute timeout
 *   maxRetryAttempts: 5, // 5 retry attempts
 *   enableTracing: false, // Disable X-Ray tracing
 *   description: 'Advanced Lambda with custom configuration',
 *   maxConcurrency: 50, // Limit to 50 concurrent executions
 *   provisionedConcurrency: 10, // Pre-warm 10 instances
 *   deadLetterQueue: myDlq,
 *   alarms: {
 *     enableErrorRateAlarm: true,
 *     enableDurationAlarm: true,
 *     enableThrottlesAlarm: true,
 *     enableDlqDepthAlarm: true,
 *     errorRateThreshold: 10, // Alert after 10 errors
 *     durationThresholdPercentage: 0.95, // Alert at 95% of timeout
 *     throttlesThreshold: 5, // Alert after 5 throttles
 *     dlqDepthThreshold: 3, // Alert when 3+ messages in DLQ
 *     evaluationPeriods: 3, // Require 3 consecutive periods
 *     alarmPeriod: Duration.minutes(2), // Check every 2 minutes
 *     alarmTopic: myAlarmTopic,
 *   },
 * });
 *
 * @example
 * // Example: SQS Event Source Lambda
 * const sqsLambda = new GoLambdaConstruct(this, 'SqsEventLambda', {
 *   appName: 'myApp',
 *   lambdaName: 'sqsEventLambda',
 *   vpc: myVpc,
 *   vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
 *   binaryPath: 'dist/sqs-handler',
 *   timeout: Duration.minutes(5),
 *   sqsEventSource: {
 *     queue: mySqsQueue,
 *     batchSize: 5, // Process up to 5 messages at once
 *     maxBatchingWindow: Duration.seconds(10), // Wait up to 10 seconds for messages
 *     maxConcurrency: 5, // Process up to 5 batches concurrently
 *     reportBatchItemFailures: true, // Enable partial batch failure reporting
 *   },
 *   deadLetterQueue: myDlq,
 *   alarms: {
 *     enableDlqDepthAlarm: true,
 *     dlqDepthThreshold: 3,
 *     alarmTopic: myAlarmTopic,
 *   },
 * });
 *
 * @example
 * // Example: SNS Event Source Lambda
 * const snsLambda = new GoLambdaConstruct(this, 'SnsEventLambda', {
 *   appName: 'myApp',
 *   lambdaName: 'snsEventLambda',
 *   vpc: myVpc,
 *   vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
 *   binaryPath: 'dist/sns-handler',
 *   timeout: Duration.minutes(2),
 *   snsEventSource: {
 *     topic: mySnsTopic,
 *     filterPolicy: {
 *       // Only process messages with specific attributes
 *       eventType: sns.SubscriptionFilter.stringFilter({
 *         allowlist: ['user.created', 'user.updated'],
 *       }),
 *       priority: sns.SubscriptionFilter.numericFilter({
 *         greaterThan: 5,
 *       }),
 *     },
 *   },
 *   alarms: {
 *     enableErrorRateAlarm: true,
 *     errorRateThreshold: 3,
 *     alarmTopic: myAlarmTopic,
 *   },
 * });
 */
export class GoLambdaConstruct extends Construct {
  /**
   * The created Lambda function resource.
   */
  public readonly lambdaFunction: lambda.Function;

  /**
   * The Lambda function version (if provisioned concurrency is enabled).
   */
  public readonly lambdaVersion?: lambda.Version;

  /**
   * The Lambda function alias (if provisioned concurrency is enabled).
   */
  public readonly lambdaAlias?: lambda.Alias;

  /**
   * Constructs a new instance of the GoLambdaConstruct with comprehensive AWS service integrations.
   *
   * @param {Construct} scope - The parent construct, typically a CDK stack.
   * @param {string} id - The unique identifier for this construct.
   * @param {GoLambdaConstructProps} props - Properties for configuring the Go Lambda function and service integrations.
   */
  constructor(scope: Construct, id: string, props: GoLambdaConstructProps) {
    super(scope, id);

    /* Validate binary path for PROVIDED_AL2 runtime */
    this.validateBinaryPath(props.binaryPath);

    /* Validate API Gateway integration configuration */
    /* Note: isProtected without authorizer will use AWS_IAM authentication */

    /* Create the Go Lambda function with configurable settings */
    this.lambdaFunction = new lambda.Function(this, props.lambdaName, {
      functionName:
        props.functionName || `${props.appName}-${props.lambdaName}`,
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      securityGroups: props.securityGroups,
      runtime: props.runtime || lambda.Runtime.PROVIDED_AL2,
      architecture: props.architecture || lambda.Architecture.ARM_64,
      handler: props.handler || "bootstrap",
      code: lambda.Code.fromAsset(props.binaryPath),
      memorySize: props.memorySize || 512,
      tracing:
        props.enableTracing !== false
          ? lambda.Tracing.ACTIVE
          : lambda.Tracing.DISABLED,
      timeout: props.timeout || Duration.seconds(30),
      logRetention: props.logRetention || logs.RetentionDays.TWO_WEEKS,
      environment: props.envVariables || undefined,
      deadLetterQueue: props.deadLetterQueue,
      description:
        props.description || `Go Lambda function for ${props.lambdaName}`,
      reservedConcurrentExecutions:
        props.reservedConcurrency !== undefined && props.reservedConcurrency > 0
          ? props.reservedConcurrency
          : props.maxConcurrency !== undefined && props.maxConcurrency > 0
          ? props.maxConcurrency
          : undefined,
    });

    /* Attach additional layers to the Lambda function if provided */
    if (props.layers) {
      props.layers.forEach((layer) => {
        this.lambdaFunction.addLayers(layer);
      });
    }

    /* Configure async retry attempts if specified */
    if (props.maxRetryAttempts !== undefined) {
      new lambda.EventInvokeConfig(this, `${props.lambdaName}-invoke-config`, {
        function: this.lambdaFunction,
        retryAttempts: props.maxRetryAttempts,
      });
    }

    /* Configure provisioned concurrency if specified */
    if (props.provisionedConcurrency && props.provisionedConcurrency > 0) {
      this.lambdaVersion = this.lambdaFunction.currentVersion;
      this.lambdaAlias = new lambda.Alias(this, `${props.lambdaName}-alias`, {
        aliasName: "live",
        version: this.lambdaVersion,
        provisionedConcurrentExecutions: props.provisionedConcurrency,
      });
    }

    /* Grant DynamoDB permissions if specified */
    if (props.dynamoDbPermissions && props.dynamoDbTables) {
      this.grantDynamoDbPermissions(
        props.dynamoDbPermissions,
        props.dynamoDbTables
      );
    }

    /* Grant S3 permissions if specified */
    if (props.s3Permissions && props.s3Buckets) {
      this.grantS3Permissions(props.s3Permissions, props.s3Buckets);
    }

    /* Grant SQS permissions if specified */
    if (props.sqsPermissions && props.sqsQueues) {
      this.grantSQSPermissions(props.sqsPermissions, props.sqsQueues);
    }

    /* Grant SNS permissions if specified */
    if (props.snsPermissions && props.snsTopics) {
      this.grantSNSPermissions(props.snsPermissions, props.snsTopics);
    }

    /* Grant KMS permissions if specified */
    if (props.kmsPermissions && props.kmsKeys) {
      this.grantKMSPermissions(props.kmsPermissions, props.kmsKeys);
    }

    /* Add custom policy statements if specified */
    if (props.customPolicyStatements) {
      props.customPolicyStatements.forEach((statement) => {
        this.lambdaFunction.addToRolePolicy(statement);
      });
    }

    /* Configure VPC endpoints if specified */
    if (props.vpcEndpoints) {
      this.configureVpcEndpoints(props.vpcEndpoints);
    }

    /* Handle API Gateway integration if specified */
    if (props.apiGwIntegration) {
      const { apiGateway, route, method } = props.apiGwIntegration;
      const stage = apiGateway.deploymentStage;

      /* Enable X-Ray tracing on API Gateway stage */
      if (stage) {
        // Enable X-Ray tracing by mutating the underlying CFN Stage
        const cfnStage = stage.node.defaultChild as apigateway.CfnStage;
        cfnStage.tracingEnabled = true;
        stage.node.addDependency(this.lambdaFunction);
      }

      /* Use alias if provisioned concurrency is enabled, otherwise use function */
      const invokeTarget = this.lambdaAlias ?? this.lambdaFunction;

      /* Create scoped API Gateway invoke permission on the same target as integration */
      invokeTarget.addPermission(`ApiGatewayInvoke-${props.lambdaName}`, {
        principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
        sourceArn: apiGateway.arnForExecuteApi(method, route, stage.stageName),
      });

      /* Automatically register the API Gateway route */
      const resource = apiGateway.root.resourceForPath(route);
      const integration = new apigateway.LambdaIntegration(invokeTarget);

      /* Determine authorization type based on authorizer type */
      let authorizationType: apigateway.AuthorizationType | undefined;
      let methodOptions: apigateway.MethodOptions = {};

      if (props.apiGwIntegration?.isProtected) {
        if (props.apiGwIntegration.authorizer) {
          // Use authorizer with appropriate type
          authorizationType =
            props.apiGwIntegration.authorizer instanceof
            apigateway.CognitoUserPoolsAuthorizer
              ? apigateway.AuthorizationType.COGNITO
              : apigateway.AuthorizationType.CUSTOM;
          methodOptions = {
            authorizer: props.apiGwIntegration.authorizer,
            authorizationType,
          };
        } else {
          // No authorizer but protected = AWS_IAM authentication
          methodOptions = {
            authorizationType: apigateway.AuthorizationType.IAM,
          };
        }
      }

      resource.addMethod(method, integration, methodOptions);

      /* Add CORS if enabled */
      if (props.apiGwIntegration.enableCors) {
        if (
          props.apiGwIntegration.isProtected &&
          !props.apiGwIntegration.corsOptions?.allowOrigins
        ) {
          throw new Error(
            "CORS allowOrigins must be explicitly specified for protected routes"
          );
        }
        const corsOptions = props.apiGwIntegration.corsOptions || {
          allowOrigins: apigateway.Cors.ALL_ORIGINS,
          allowMethods: apigateway.Cors.ALL_METHODS,
          allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
        };
        resource.addCorsPreflight(corsOptions);
      }
    }

    /* Configure SQS event source if specified */
    if (props.sqsEventSource) {
      this.configureSQSEventSource(props.sqsEventSource);
    }

    /* Configure SNS event source if specified */
    if (props.snsEventSource) {
      this.configureSNSEventSource(props.snsEventSource);
    }

    /* Create CloudWatch alarms if specified */
    if (props.alarms) {
      this.createCloudWatchAlarms(props);
    }
  }

  /**
   * Validates the binary path for PROVIDED_AL2 runtime.
   *
   * @param {string} binaryPath - The path to validate.
   */
  private validateBinaryPath(binaryPath: string) {
    const fullPath = path.resolve(binaryPath);

    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const bootstrapPath = path.join(fullPath, "bootstrap");
        if (!fs.existsSync(bootstrapPath)) {
          throw new Error(
            `bootstrap executable not found in ${binaryPath}. For PROVIDED_AL2 runtime, the binary must be named 'bootstrap' and be executable.`
          );
        }
        const bootstrapStat = fs.statSync(bootstrapPath);
        if (!bootstrapStat.isFile()) {
          throw new Error(`bootstrap in ${binaryPath} is not a file.`);
        }
        /* Validate executable bit on Unix systems */
        try {
          fs.accessSync(bootstrapPath, fs.constants.X_OK);
        } catch {
          throw new Error(
            `bootstrap in ${binaryPath} is not executable. Run: chmod +x ${bootstrapPath}`
          );
        }
      } else if (stat.isFile() && !binaryPath.endsWith(".zip")) {
        throw new Error(
          `Binary path ${binaryPath} is a file but not a .zip file. For PROVIDED_AL2 runtime, provide either a directory containing 'bootstrap' or a .zip file.`
        );
      }
    } else {
      throw new Error(`Binary path ${binaryPath} does not exist.`);
    }
  }

  /**
   * Creates CloudWatch alarms for the Lambda function.
   *
   * @param {GoLambdaConstructProps} props - The construct props.
   */
  private createCloudWatchAlarms(props: GoLambdaConstructProps) {
    const alarms = props.alarms!;
    const functionName = this.lambdaFunction.functionName;
    const alarmPeriod = alarms.alarmPeriod || Duration.minutes(5);
    const evaluationPeriods = alarms.evaluationPeriods || 2;

    /* Error rate alarm */
    if (alarms.enableErrorRateAlarm !== false) {
      const errorRateAlarm = new cloudwatch.Alarm(
        this,
        `${props.lambdaName}-error-rate`,
        {
          alarmName: `${functionName}-error-rate`,
          metric: this.lambdaFunction.metricErrors({
            period: alarmPeriod,
            statistic: "Sum",
          }),
          threshold: alarms.errorRateThreshold || 1,
          evaluationPeriods: evaluationPeriods,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        }
      );

      if (alarms.alarmTopic) {
        errorRateAlarm.addAlarmAction(
          new cloudwatch_actions.SnsAction(alarms.alarmTopic)
        );
      }
    }

    /* Duration alarm */
    if (alarms.enableDurationAlarm !== false) {
      const durationThreshold =
        (props.timeout || Duration.seconds(30)).toMilliseconds() *
        (alarms.durationThresholdPercentage || 0.8);
      const durationAlarm = new cloudwatch.Alarm(
        this,
        `${props.lambdaName}-duration`,
        {
          alarmName: `${functionName}-duration`,
          metric: this.lambdaFunction.metricDuration({
            period: alarmPeriod,
            statistic: "Average",
          }),
          threshold: durationThreshold,
          evaluationPeriods: evaluationPeriods,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        }
      );

      if (alarms.alarmTopic) {
        durationAlarm.addAlarmAction(
          new cloudwatch_actions.SnsAction(alarms.alarmTopic)
        );
      }
    }

    /* Throttles alarm */
    if (alarms.enableThrottlesAlarm !== false) {
      const throttlesAlarm = new cloudwatch.Alarm(
        this,
        `${props.lambdaName}-throttles`,
        {
          alarmName: `${functionName}-throttles`,
          metric: this.lambdaFunction.metricThrottles({
            period: alarmPeriod,
            statistic: "Sum",
          }),
          threshold: alarms.throttlesThreshold || 1,
          evaluationPeriods: 1, // Throttles should be immediate
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        }
      );

      if (alarms.alarmTopic) {
        throttlesAlarm.addAlarmAction(
          new cloudwatch_actions.SnsAction(alarms.alarmTopic)
        );
      }
    }

    /* Dead letter queue depth alarm */
    if (alarms.enableDlqDepthAlarm !== false && props.deadLetterQueue) {
      const dlqDepthAlarm = new cloudwatch.Alarm(
        this,
        `${props.lambdaName}-dlq-depth`,
        {
          alarmName: `${functionName}-dlq-depth`,
          metric:
            props.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
              period: alarmPeriod,
              statistic: "Average",
            }),
          threshold: alarms.dlqDepthThreshold || 1,
          evaluationPeriods: 1, // DLQ depth should be immediate
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        }
      );

      if (alarms.alarmTopic) {
        dlqDepthAlarm.addAlarmAction(
          new cloudwatch_actions.SnsAction(alarms.alarmTopic)
        );
      }
    }
  }

  /**
   * Grants DynamoDB permissions to the Lambda function.
   *
   * @param {DynamoDBPermissions[]} permissions - DynamoDB permissions to grant.
   * @param {dynamodb.ITable[]} tables - DynamoDB tables to grant access to.
   */
  private grantDynamoDbPermissions(
    permissions: DynamoDBPermissions[],
    tables: dynamodb.ITable[]
  ) {
    tables.forEach((table) => {
      /* Use grantReadData/grantWriteData which include all necessary permissions */
      const hasReadPermissions = permissions.some((p) =>
        [
          DynamoDBPermissions.QUERY,
          DynamoDBPermissions.SCAN,
          DynamoDBPermissions.GET_ITEM,
          DynamoDBPermissions.BATCH_GET_ITEM,
        ].includes(p)
      );
      const hasWritePermissions = permissions.some((p) =>
        [
          DynamoDBPermissions.PUT_ITEM,
          DynamoDBPermissions.UPDATE_ITEM,
          DynamoDBPermissions.DELETE_ITEM,
          DynamoDBPermissions.BATCH_WRITE_ITEM,
        ].includes(p)
      );

      if (hasReadPermissions) {
        table.grantReadData(this.lambdaFunction);
      }
      if (hasWritePermissions) {
        table.grantWriteData(this.lambdaFunction);
      }
    });

    /* Add global permissions only if needed */
    if (permissions.includes(DynamoDBPermissions.LIST_TABLES)) {
      this.lambdaFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [DynamoDBPermissions.LIST_TABLES],
          resources: ["*"],
        })
      );
    }
  }

  /**
   * Grants S3 permissions to the Lambda function.
   *
   * @param {S3Permissions[]} permissions - S3 permissions to grant.
   * @param {s3.IBucket[]} buckets - S3 buckets to grant access to.
   */
  private grantS3Permissions(
    permissions: S3Permissions[],
    buckets: s3.IBucket[]
  ) {
    buckets.forEach((bucket) => {
      /* Use grantRead/Write/Delete which include all necessary permissions */
      const hasReadPermissions = permissions.some((p) =>
        [S3Permissions.GET_OBJECT, S3Permissions.LIST_BUCKET].includes(p)
      );
      const hasWritePermissions = permissions.some((p) =>
        [S3Permissions.PUT_OBJECT].includes(p)
      );
      const hasDeletePermissions = permissions.some((p) =>
        [S3Permissions.DELETE_OBJECT].includes(p)
      );

      if (hasReadPermissions) {
        bucket.grantRead(this.lambdaFunction);
      }
      if (hasWritePermissions) {
        bucket.grantWrite(this.lambdaFunction);
      }
      if (hasDeletePermissions) {
        bucket.grantDelete(this.lambdaFunction);
      }

      /* Add versioned delete permission if requested */
      if (permissions.includes(S3Permissions.DELETE_OBJECT_VERSION)) {
        this.lambdaFunction.addToRolePolicy(
          new iam.PolicyStatement({
            actions: ["s3:DeleteObjectVersion"],
            resources: [`${bucket.bucketArn}/*`],
          })
        );
      }
    });

    /* Add bucket-level permissions only if needed */
    const bucketPermissions = permissions.filter((p) =>
      [
        S3Permissions.GET_BUCKET_LOCATION,
        S3Permissions.GET_BUCKET_VERSIONING,
      ].includes(p)
    );

    if (bucketPermissions.length > 0) {
      this.lambdaFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: bucketPermissions,
          resources: buckets.map((bucket) => bucket.bucketArn),
        })
      );
    }
  }

  /**
   * Grants SQS permissions to the Lambda function.
   *
   * @param {SQSPermissions[]} permissions - SQS permissions to grant.
   * @param {sqs.IQueue[]} queues - SQS queues to grant access to.
   */
  private grantSQSPermissions(
    permissions: SQSPermissions[],
    queues: sqs.IQueue[]
  ) {
    queues.forEach((queue) => {
      /* Use grantSendMessages/grantConsumeMessages which include all necessary permissions */
      const hasSendPermissions = permissions.includes(
        SQSPermissions.SEND_MESSAGE
      );
      const hasConsumePermissions = permissions.some((p) =>
        [
          SQSPermissions.RECEIVE_MESSAGE,
          SQSPermissions.DELETE_MESSAGE,
        ].includes(p)
      );

      if (hasSendPermissions) {
        queue.grantSendMessages(this.lambdaFunction);
      }
      if (hasConsumePermissions) {
        queue.grantConsumeMessages(this.lambdaFunction);
      }
    });

    /* Add queue-level permissions only if needed */
    const queuePermissions = permissions.filter((p) =>
      [
        SQSPermissions.GET_QUEUE_ATTRIBUTES,
        SQSPermissions.PURGE_QUEUE,
      ].includes(p)
    );

    if (queuePermissions.length > 0) {
      this.lambdaFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: queuePermissions,
          resources: queues.map((queue) => queue.queueArn),
        })
      );
    }

    /* Add list permissions only if needed */
    if (permissions.includes(SQSPermissions.LIST_QUEUES)) {
      this.lambdaFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [SQSPermissions.LIST_QUEUES],
          resources: ["*"],
        })
      );
    }
  }

  /**
   * Grants SNS permissions to the Lambda function.
   *
   * @param {SNSPermissions[]} permissions - SNS permissions to grant.
   * @param {sns.ITopic[]} topics - SNS topics to grant access to.
   */
  private grantSNSPermissions(
    permissions: SNSPermissions[],
    topics: sns.ITopic[]
  ) {
    topics.forEach((topic) => {
      /* Use grantPublish/grantSubscribe which include all necessary permissions */
      const hasPublishPermissions = permissions.includes(
        SNSPermissions.PUBLISH
      );
      const hasSubscribePermissions = permissions.some((p) =>
        [SNSPermissions.SUBSCRIBE, SNSPermissions.UNSUBSCRIBE].includes(p)
      );

      if (hasPublishPermissions) {
        topic.grantPublish(this.lambdaFunction);
      }
      if (hasSubscribePermissions) {
        topic.grantSubscribe(this.lambdaFunction);
      }
    });

    /* Add topic-level permissions only if needed */
    const topicPermissions = permissions.filter((p) =>
      [SNSPermissions.GET_TOPIC_ATTRIBUTES].includes(p)
    );

    if (topicPermissions.length > 0) {
      this.lambdaFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: topicPermissions,
          resources: topics.map((topic) => topic.topicArn),
        })
      );
    }

    /* Add list permissions only if needed */
    if (permissions.includes(SNSPermissions.LIST_TOPICS)) {
      this.lambdaFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [SNSPermissions.LIST_TOPICS],
          resources: ["*"],
        })
      );
    }
  }

  /**
   * Grants KMS permissions to the Lambda function.
   *
   * @param {KMSPermissions[]} permissions - KMS permissions to grant.
   * @param {kms.IKey[]} keys - KMS keys to grant access to.
   */
  private grantKMSPermissions(permissions: KMSPermissions[], keys: kms.IKey[]) {
    keys.forEach((key) => {
      if (permissions.includes(KMSPermissions.ENCRYPT)) {
        key.grantEncrypt(this.lambdaFunction);
      }
      if (permissions.includes(KMSPermissions.DECRYPT)) {
        key.grantDecrypt(this.lambdaFunction);
      }
      if (permissions.includes(KMSPermissions.GENERATE_DATA_KEY)) {
        key.grant(this.lambdaFunction, "kms:GenerateDataKey");
      }
      if (permissions.includes(KMSPermissions.RE_ENCRYPT)) {
        // Note: Re-encrypt often needs permissions on both source and destination keys
        // If you see AccessDenied on re-encrypt, grant both sides explicitly
        key.grant(this.lambdaFunction, "kms:ReEncrypt*");
      }
    });

    /* Add key-level permissions */
    const keyPermissions = permissions.filter((p) =>
      [KMSPermissions.DESCRIBE_KEY].includes(p)
    );

    if (keyPermissions.length > 0) {
      this.lambdaFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: keyPermissions,
          resources: keys.map((key) => key.keyArn),
        })
      );
    }
  }

  /**
   * Configures VPC endpoints for the Lambda function to connect to specified endpoints.
   *
   * @param {(ec2.InterfaceVpcEndpoint | ec2.GatewayVpcEndpoint)[]} vpcEndpoints - Array of VPC endpoints to allow connections.
   */
  private configureVpcEndpoints(
    vpcEndpoints: (ec2.InterfaceVpcEndpoint | ec2.GatewayVpcEndpoint)[]
  ) {
    vpcEndpoints.forEach((endpoint) => {
      if (endpoint instanceof ec2.InterfaceVpcEndpoint) {
        this.lambdaFunction.connections.allowTo(
          endpoint,
          ec2.Port.tcp(443),
          `Allow Lambda to connect to VPC Interface Endpoint ${endpoint.vpcEndpointId}`
        );
      }
    });
  }

  /**
   * Configures SQS event source for the Lambda function.
   *
   * @param {object} sqsEventSource - SQS event source configuration.
   */
  private configureSQSEventSource(sqsEventSource: {
    queue: sqs.IQueue;
    batchSize?: number;
    maxBatchingWindow?: Duration;
    maxConcurrency?: number;
    reportBatchItemFailures?: boolean;
  }) {
    /* Grant SQS permissions to the Lambda function */
    sqsEventSource.queue.grantConsumeMessages(this.lambdaFunction);

    /* Create SQS event source mapping */
    this.lambdaFunction.addEventSourceMapping(
      `SqsESM-${sqsEventSource.queue.queueName}`,
      {
        eventSourceArn: sqsEventSource.queue.queueArn,
        batchSize: sqsEventSource.batchSize ?? 10,
        maxBatchingWindow:
          sqsEventSource.maxBatchingWindow ?? Duration.seconds(20),
        maxConcurrency: sqsEventSource.maxConcurrency,
        reportBatchItemFailures:
          sqsEventSource.reportBatchItemFailures !== false,
      }
    );
  }

  /**
   * Configures SNS event source for the Lambda function.
   *
   * @param {object} snsEventSource - SNS event source configuration.
   */
  private configureSNSEventSource(snsEventSource: {
    topic: sns.ITopic;
    filterPolicy?: { [attribute: string]: sns.SubscriptionFilter };
  }) {
    /* Create SNS subscription (automatically grants SNS→Lambda permissions) */
    snsEventSource.topic.addSubscription(
      new sns_subscriptions.LambdaSubscription(this.lambdaFunction, {
        filterPolicy: snsEventSource.filterPolicy,
      })
    );
  }
}
