import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { Duration } from "aws-cdk-lib";
import { APIGatewayWithCognitoUserPoolConstruct } from "@constructs/APIGatewayWithCognitoUserPoolConstruct";

/**
 * Defines API Gateway integration details.
 */
export interface ApiGwIntegrationProps {
  /**
   * The API Gateway instance to attach this Lambda function to.
   */
  apiGateway: APIGatewayWithCognitoUserPoolConstruct;

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
}

/***
 * Enum for API Gateway HTTP methods.
 */
export enum APIMethodsEnum {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
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

  /* Write Operations */
  PUT_ITEM = "dynamodb:PutItem", // Insert a new item
  UPDATE_ITEM = "dynamodb:UpdateItem", // Modify an existing item
  DELETE_ITEM = "dynamodb:DeleteItem", // Remove an item
  BATCH_WRITE_ITEM = "dynamodb:BatchWriteItem", // Write multiple items at once
}

/**
 * Properties for configuring the LambdaConstruct.
 */
export interface LambdaConstructProps {
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
   * The directory path to the entry file for the Lambda function.
   */
  entry: string;

  /**
   * The timeout for the Lambda function (default: 30 seconds).
   */
  timeout?: Duration;

  /**
   * Additional permissions required by the Lambda function (optional).
   */
  permissions?: DynamoDBPermissions[];

  /**
   * VPC endpoints that the Lambda function can access (optional).
   */
  vpcEndpoints?: (ec2.InterfaceVpcEndpoint | ec2.GatewayVpcEndpoint)[];

  /**
   * Lambda layers to include in the Lambda function (optional).
   */
  layers?: lambda.ILayerVersion[];

  /**
   * Node modules to bundle with the Lambda function (optional).
   */
  nodeModules?: string[];

  /**
   * External modules to exclude from bundling in the Lambda function (optional).
   */
  externalModules?: string[];

  /**
   * Environment variables to pass to the Lambda function (optional).
   */
  envVariables?: { [key: string]: string };

  /**
   * Optional API Gateway integration settings.
   */
  apiGwIntegration?: ApiGwIntegrationProps;
}

/**
 * Creates a Lambda function with optional API Gateway integration.
 *
 * If `apiGwIntegration` is provided, the Lambda function will be automatically
 * registered as an API Gateway route.
 *
 * @example
 * // Example: Using Lambda with API Gateway
 * const lambdaWithApi = new LambdaConstruct(this, 'ApiLambda', {
 *   appName: 'myApp',
 *   lambdaName: 'myApiLambda',
 *   vpc: myVpc,
 *   vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE },
 *   entry: 'index.ts',
 *   apiGwIntegration: {
 *     apiGateway: myApiGateway,
 *     route: '/projects',
 *     method: APIMethodsEnum.GET,
 *     isProtected: true,
 *   },
 * });
 *
 * @example
 * // Example: Using Lambda without API Gateway (e.g., for SQS/EventBridge)
 * const lambdaWithoutApi = new LambdaConstruct(this, 'SqsLambda', {
 *   appName: 'myApp',
 *   lambdaName: 'mySqsLambda',
 *   vpc: myVpc,
 *   vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE },
 *   entry: 'sqs-handler.ts',
 * });
 */
export class LambdaConstruct extends Construct {
  /**
   * The created Lambda function resource.
   */
  public readonly lambdaFunction: lambda.Function;

  /**
   * Constructs a new instance of the LambdaConstruct with optional API Gateway integration.
   *
   * @param {Construct} scope - The parent construct, typically a CDK stack.
   * @param {string} id - The unique identifier for this construct.
   * @param {LambdaConstructProps} props - Properties for configuring the Lambda function and API Gateway integration.
   */
  constructor(scope: Construct, id: string, props: LambdaConstructProps) {
    super(scope, id);

    const depsLockFilePath = props.entry.replace(/\/[^/]+\.ts$/, "/package-lock.json");

    /* Create the Lambda function with configurable entry file and settings */
    this.lambdaFunction = new nodejs.NodejsFunction(this, props.lambdaName, {
      functionName: `${props.lambdaName}`,
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      depsLockFilePath: depsLockFilePath,
      memorySize: 512,
      entry: props.entry,
      tracing: lambda.Tracing.ACTIVE,
      timeout: props.timeout || Duration.seconds(30),
      logRetention: 14,
      environment: props.envVariables || undefined,
      bundling: {
        sourceMap: false,
        nodeModules: props.nodeModules || [],
        externalModules: props.externalModules || ["@aws-sdk/*", "aws-lambda"],
        format: OutputFormat.ESM,
      },
      description: `Lambda function for ${props.lambdaName}`,
    });

    /* Attach additional layers to the Lambda function if provided */
    if (props.layers) {
      props.layers.forEach((layer) => {
        this.lambdaFunction.addLayers(layer);
      });
    }

    /* Grant the required IAM permissions to the Lambda function */
    if (props.permissions) {
      this.addPermissions(props.permissions);
    }

    /* Configure VPC endpoints if specified */
    if (props.vpcEndpoints) {
      this.configureVpcEndpoints(props.vpcEndpoints);
    }

    /* Handle API Gateway integration if specified */
    if (props.apiGwIntegration) {
      this.lambdaFunction.addPermission("ApiGatewayInvoke", {
        principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      });

      /* Automatically register the API Gateway route */
      props.apiGwIntegration.apiGateway.addMethod(
        props.apiGwIntegration.route,
        props.apiGwIntegration.method,
        this.lambdaFunction,
        props.apiGwIntegration.isProtected ?? false
      );
    }
  }

  /**
   * Adds additional permissions to the Lambda function's IAM role.
   *
   * @param {string[]} permissions - A list of actions the Lambda function is allowed to perform.
   */
  private addPermissions(permissions: string[]) {
    this.lambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: permissions,
        resources: ["*"],
      })
    );
  }

  /**
   * Configures VPC endpoints for the Lambda function to connect to specified endpoints.
   *
   * @param {(ec2.InterfaceVpcEndpoint | ec2.GatewayVpcEndpoint)[]} vpcEndpoints - Array of VPC endpoints to allow connections.
   */
  private configureVpcEndpoints(vpcEndpoints: (ec2.InterfaceVpcEndpoint | ec2.GatewayVpcEndpoint)[]) {
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
}
