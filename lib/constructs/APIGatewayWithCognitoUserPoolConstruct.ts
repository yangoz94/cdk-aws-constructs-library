import * as cognito from "aws-cdk-lib/aws-cognito";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { Duration, RemovalPolicy } from "aws-cdk-lib";

/**
 * Configuration options for Cognito setup in APIGatewayConstruct.
 */
export interface CognitoConfig {
  selfSignUpEnabled?: boolean;
  userVerification?: {
    emailSubject: string;
    emailBody: string;
    emailStyle: cognito.VerificationEmailStyle;
  };
  passwordPolicy?: {
    minLength?: number;
    requireLowercase?: boolean;
    requireUppercase?: boolean;
    requireDigits?: boolean;
    requireSymbols?: boolean;
  };
  callbackUrls: string[];
  logoutUrls: string[];
  userGroups?: { groupName: string }[];
  flows?: {
    authCodeGrant?: boolean;
    implicitCodeGrant?: boolean;
  };
}

/**
 * Properties for configuring the APIGatewayConstruct with Cognito authentication.
 */
export interface APIGatewayWithCognitoUserPoolConstructProps
  extends apigw.RestApiProps {
  appName: string;
  apiSubDomain: string;
  authSubdomain: string;
  domain: string;
  hostedZoneId: string;
  cognitoConfig?: CognitoConfig;
}

/**
 * Creates an Edge-optimized REST API Gateway with custom domain, certificate,
 * access logging, Route 53 alias record configuration, and Cognito User Pool authentication.
 */
export class APIGatewayWithCognitoUserPoolConstruct extends Construct {
  public readonly restApi: apigw.RestApi;
  public readonly authorizer: apigw.CognitoUserPoolsAuthorizer;
  private readonly domain: string;

  /**
   * Constructs a new instance of the APIGatewayConstruct.
   */
  constructor(
    scope: Construct,
    id: string,
    props: APIGatewayWithCognitoUserPoolConstructProps
  ) {
    super(scope, id);

    /* Store domain for later use in other methods */
    this.domain = props.domain;

    /* Cognito User Pool setup */
    const userPool = new cognito.UserPool(this, `${props.appName}-userpool`, {
      userPoolName: `${props.appName}-userpool`,
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
      selfSignUpEnabled: props.cognitoConfig?.selfSignUpEnabled || false,
      signInAliases: { username: true, email: true },
      autoVerify: props.cognitoConfig?.userVerification
        ? { email: true }
        : undefined,
      userVerification: props.cognitoConfig?.userVerification,
      passwordPolicy: props.cognitoConfig?.passwordPolicy || {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
    });

    /* Add User Pool id to SSM */
    new ssm.StringParameter(this, `${props.appName}-userpool-id`, {
      parameterName: `/${props.appName}/userpool-id`,
      stringValue: userPool.userPoolId,
    });

    /* Cognito User Pool Client */
    const userPoolClient = new cognito.UserPoolClient(
      this,
      `${props.appName}-userpool-client`,
      {
        userPool,
        authFlows: { userPassword: true, userSrp: true },
        oAuth: {
          callbackUrls: props.cognitoConfig?.callbackUrls || [],
          logoutUrls: props.cognitoConfig?.logoutUrls || [],
        },
        idTokenValidity: Duration.minutes(15),
        accessTokenValidity: Duration.minutes(15),
        refreshTokenValidity: Duration.days(1),
      }
    );

    /* Store User Pool Client ID in SSM (required for registering new users / getting the idtokens of existing users) */
    new ssm.StringParameter(this, `${props.appName}-userpool-client-id`, {
      parameterName: `/${props.appName}/userpool-client-id`,
      stringValue: userPoolClient.userPoolClientId,
    });

    /* Cognito User Pool Groups */
    if (props.cognitoConfig?.userGroups) {
      for (const group of props.cognitoConfig.userGroups) {
        new cognito.CfnUserPoolGroup(this, `${group.groupName}-group`, {
          groupName: group.groupName,
          userPoolId: userPool.userPoolId,
        });
      }
    }

    /* API Gateway Cognito Authorizer */
    this.authorizer = new apigw.CognitoUserPoolsAuthorizer(
      this,
      `${props.appName}-cognito-authorizer`,
      {
        cognitoUserPools: [userPool],
      }
    );

    /* Access Logging Setup */
    const accessLogGroup = new logs.LogGroup(
      this,
      `${props.appName}-access-log-group`,
      {
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    /* API Gateway Setup */
    this.restApi = new apigw.RestApi(this, `${props.appName}-api-gw`, {
      restApiName: `${props.appName}-api-gw`,
      endpointConfiguration: { types: [apigw.EndpointType.EDGE] },
      defaultCorsPreflightOptions: {
        allowOrigins: [
          `https://${props.domain}`,
          `https://*.${props.domain}`,
          `http://localhost:3000` /* TO-DO: Remove this in production once it's not needed anymore */,
        ],
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
          "X-Amz-Security-Token",
        ],
      },
      deployOptions: {
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
        accessLogDestination: new apigw.LogGroupLogDestination(accessLogGroup),
        accessLogFormat: apigw.AccessLogFormat.jsonWithStandardFields(),
        description: `API Gateway for ${props.appName}`,
        /* Rate limiting configuration to prevent abuse */
        throttlingRateLimit: 5 /* 5 requests per second */,
        throttlingBurstLimit: 10 /* 10 concurrent requests */,
      },
      cloudWatchRole: true,
      cloudWatchRoleRemovalPolicy: RemovalPolicy.DESTROY,
    });

    /* Custom Domain Configuration */
    const hostedZone = route53.HostedZone.fromHostedZoneId(
      this,
      `${props.appName}-hosted-zone`,
      props.hostedZoneId
    );

    const certificate = new certificatemanager.Certificate(
      this,
      `${props.appName}-api-certificate`,
      {
        domainName: `${props.apiSubDomain}.${props.domain}`,
        validation:
          certificatemanager.CertificateValidation.fromDns(hostedZone),
      }
    );

    const domainName = new apigw.DomainName(
      this,
      `${props.appName}-domain-name`,
      {
        domainName: `${props.apiSubDomain}.${props.domain}`,
        certificate,
        endpointType: apigw.EndpointType.EDGE,
        securityPolicy: apigw.SecurityPolicy.TLS_1_2,
        mapping: this.restApi,
      }
    );

    /* Route 53 Alias Record */
    new route53.ARecord(this, `${props.appName}-alias-record`, {
      zone: route53.HostedZone.fromHostedZoneAttributes(
        this,
        `${props.appName}-hosted-zone-attributes-for-api`,
        {
          hostedZoneId: props.hostedZoneId,
          zoneName: props.domain,
        }
      ),
      recordName: `${props.apiSubDomain}.${props.domain}`,
      target: route53.RecordTarget.fromAlias(
        new targets.ApiGatewayDomain(domainName)
      ),
      ttl: Duration.minutes(5),
    });

    /* Hosted UI Custom Domain */
    const hostedUICertificate = new certificatemanager.Certificate(
      this,
      `${props.appName}-auth-certificate`,
      {
        domainName: `${props.authSubdomain}.${props.domain}`,
        certificateName: `${props.appName}-auth-certificate`,
        validation:
          certificatemanager.CertificateValidation.fromDns(hostedZone),
      }
    );

    const userPoolDomain = new cognito.UserPoolDomain(
      this,
      `${props.appName}-userpool-domain`,
      {
        userPool,
        customDomain: {
          domainName: `${props.authSubdomain}.${props.domain}`,
          certificate: hostedUICertificate,
        },
      }
    );

    /* Route 53 Alias Record for Hosted UI */
    new route53.ARecord(this, `${props.appName}-auth-alias-record`, {
      zone: route53.HostedZone.fromHostedZoneAttributes(
        this,
        `${props.appName}-hosted-zone-attributes-for-auth`,
        {
          hostedZoneId: props.hostedZoneId,
          zoneName: props.domain,
        }
      ),
      recordName: `${props.authSubdomain}.${props.domain}`,
      target: route53.RecordTarget.fromAlias(
        new targets.UserPoolDomainTarget(userPoolDomain)
      ),
      ttl: Duration.minutes(5),
    });
  }

  /**
   * Adds a new method to the specified API Gateway resource path, integrating it with a Lambda function and optional Cognito authorization.
   *
   * @param {string} resourcePath - The resource path for the API Gateway endpoint (e.g., '/v1/test').
   * @param {string} httpMethod - The HTTP method for the endpoint (e.g., 'GET', 'POST').
   * @param {lambda.Function} lambdaFunction - The Lambda function to integrate with the API Gateway method.
   * @param {boolean} [isProtected=false] - Whether the endpoint should be protected by Cognito authorization.
   *
   * @example
   * // Adds a protected GET endpoint at '/v1/test' integrated with helloFunction Lambda
   * apiGateway.addMethod('/v1/test', 'GET', helloFunction, true);
   *
   * // Adds an unprotected POST endpoint at '/v1/test2' integrated with helloFunction Lambda
   * apiGateway.addMethod('/v1/test2', 'POST', helloFunction, false);
   */
  public addMethod(
    resourcePath: string,
    httpMethod: string,
    lambdaFunction: lambda.Function,
    isProtected: boolean = false
  ) {
    let resource = this.restApi.root;
    const pathParts = resourcePath.split("/").filter(Boolean);

    pathParts.forEach((part) => {
      resource = resource.getResource(part) ?? resource.addResource(part);
    });

    /* Enable CORS for this resource if not already enabled */
    if (!resource.defaultCorsPreflightOptions) {
      resource.addCorsPreflight({
        allowOrigins: [
          `https://${this.domain}`,
          `https://*.${this.domain}`,
          "http://localhost:3000",
        ],
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
          "X-Amz-Security-Token",
        ],
      });
    }

    resource.addMethod(
      httpMethod,
      new apigw.LambdaIntegration(lambdaFunction, {
        proxy: true,
        /* Ensure Lambda returns proper CORS headers */
        integrationResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": "'*'",
            },
          },
        ],
      }),
      {
        authorizer: isProtected ? this.authorizer : undefined,
        authorizationType: isProtected
          ? apigw.AuthorizationType.COGNITO
          : apigw.AuthorizationType.NONE,
        /* Configure method response to include CORS headers */
        methodResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": true,
            },
          },
        ],
      }
    );
  }
}
