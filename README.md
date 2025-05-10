# AWS CDK Constructs Library

This library provides a collection of reusable AWS CDK constructs designed to simplify the deployment of common AWS infrastructure patterns. Each construct is built with best practices in mind and includes proper TypeScript typing, validation, and documentation.

## Available Constructs

| Construct                                                                                                    | Description                                                                                                                                                                              | Source                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [NetworkingConstruct](lib/constructs/NetworkingConstruct.ts)                                                 | Creates a cost-effective VPC with public and private isolated subnets, internet gateway, and appropriate route tables, designed for simple personal websites/blogs without NAT gateways. | [View Source](lib/constructs/NetworkingConstruct.ts)                         |
| [MultiServiceECSFargateLoadBalancedConstruct](lib/constructs/MultiServiceECSFargateLoadBalancedConstruct.ts) | Deploys multiple ECS Fargate services behind an Application Load Balancer with HTTPS support, auto-scaling, health checks, and Route 53 integration.                                     | [View Source](lib/constructs/MultiServiceECSFargateLoadBalancedConstruct.ts) |
| [SingleServicePrivateECSFargateConstruct](lib/constructs/SingleServicePrivateECSFargateConstruct.ts)         | Deploys a single private ECS Fargate service with VPC integration, logging, and health monitoring, suitable for internal microservices.                                                  | [View Source](lib/constructs/SingleServicePrivateECSFargateConstruct.ts)     |
| [S3CloudFrontConstruct](lib/constructs/S3CloudfrontConstruct.ts)                                             | Creates an S3 bucket with CloudFront distribution for content delivery, including SSL certificate management, Route 53 integration, and proper security configurations.                  | [View Source](lib/constructs/S3CloudfrontConstruct.ts)                       |
| [LambdaConstruct](lib/constructs/LambdaConstruct.ts)                                                         | Deploys AWS Lambda functions with optional API Gateway integration, VPC support, and configurable permissions, designed for both API and event-driven use cases.                         | [View Source](lib/constructs/LambdaConstruct.ts)                             |
| [OIDCRoleConstruct](lib/constructs/OIDCRoleConstruct.ts)                                                     | Sets up GitHub Actions OIDC provider and roles for secure CI/CD deployments, including necessary permissions for CDK deployments and AWS resource management.                            | [View Source](lib/constructs/OIDCRoleConstruct.ts)                           |
| [APIGatewayWithCognitoUserPoolConstruct](lib/constructs/APIGatewayWithCognitoUserPoolConstruct.ts)           | Creates an API Gateway with Cognito User Pool authentication, enabling secure API endpoints with user management and authorization capabilities.                                         | [View Source](lib/constructs/APIGatewayWithCognitoUserPoolConstruct.ts)      |
| [CommonLayerConstruct](lib/constructs/CommonLayerConstruct.ts)                                               | Creates a shared Lambda layer containing common entities and utilities that can be reused across multiple Lambda functions, optimized for Node.js 20.x and ARM64 architecture.           | [View Source](lib/constructs/CommonLayerConstruct.ts)                        |

## Usage

Each construct is designed to be modular and follows AWS best practices. They can be used independently or combined to create complex infrastructure patterns. Detailed documentation and examples are available in each construct's source code.

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests
