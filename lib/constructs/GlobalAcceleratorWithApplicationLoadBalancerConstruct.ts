import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as globalaccelerator from "aws-cdk-lib/aws-globalaccelerator";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as ga_endpoints from "aws-cdk-lib/aws-globalaccelerator-endpoints";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53_targets from "aws-cdk-lib/aws-route53-targets";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { StringParameter } from "aws-cdk-lib/aws-ssm";

/* 
1. Global Accelerator
2. Application Load Balancer
*/

export interface GlobalAcceleratorWithApplicationLoadBalancerConstructProps extends cdk.StackProps {
  appName: string;
  vpc: ec2.IVpc;
  tagEnv: string;
  domainName: string;
  apiSubdomainName: string;
}

export class GlobalAcceleratorWithApplicationLoadBalancerConstruct extends Construct {
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly httpListener: elbv2.ApplicationListener;
  public readonly httpsListener?: elbv2.ApplicationListener;

  constructor(scope: Construct, id: string, props: GlobalAcceleratorWithApplicationLoadBalancerConstructProps) {
    super(scope, id);

    const region = cdk.Stack.of(this).region;

    /* Lookup the hosted zone */
    const hostedZone = route53.HostedZone.fromLookup(
      this,
      `${props.appName}-hosted-zone-lookup`,
      {
        domainName: `${props.tagEnv}.${props.domainName}`,
      }
    );

    /* Create Global Accelerator */
    const accelerator = new globalaccelerator.Accelerator(
      this,
      `${props.appName}-global-accelerator`,
      {
        acceleratorName: `${props.appName}-global-accelerator`,
      }
    );

    /* Create an HTTP Listener for the Accelerator */
    const httpListener = accelerator.addListener(
      `${props.appName}-http-listener`,
      {
        listenerName: `${props.appName}-http-listener`,
        portRanges: [{ fromPort: 80 }],
      }
    );

    /* Create a Listener for the Accelerator */
    const httpsListener = accelerator.addListener(
      `${props.appName}-https-listener`,
      {
        listenerName: `${props.appName}-https-listener`,
        portRanges: [{ fromPort: 443 }],
      }
    );

    /* Create an A record in Route 53 that points to the Global Accelerator's DNS name */
    new route53.ARecord(this, `${props.appName}-alias-record`, {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.GlobalAcceleratorTarget(accelerator)
      ),
      recordName: `${props.apiSubdomainName}.${props.tagEnv}.${props.domainName}`,
    });

    /* Create the Application Load Balancer */
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      `${props.appName}-${props.tagEnv}-load-balancer-construct`,
      {
        vpc: props.vpc,
        internetFacing: true,
        loadBalancerName: `${props.appName}-${props.tagEnv}-alb`,
        vpcSubnets: {
          subnets: props.vpc.selectSubnets({
            onePerAz: true,
            subnetType: ec2.SubnetType.PUBLIC,
          }).subnets,
        },
      }
    );

    /* Create a certificate for the load balancer */
    const certificate = new acm.Certificate(
      this,
      `${props.appName}-certificate`,
      {
        domainName: `${region}.${props.apiSubdomainName}.${props.tagEnv}.${props.domainName}`,
        subjectAlternativeNames: [
          `${props.apiSubdomainName}.${props.tagEnv}.${props.domainName}`,
        ],
        validation: acm.CertificateValidation.fromDns(hostedZone),
      }
    );

    /* Create a listener for the load balancer */
    this.httpsListener = this.loadBalancer.addListener(
      `${props.appName}-https-listener`,
      {
        port: 443,
        certificates: [certificate],
        sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
        defaultAction: elbv2.ListenerAction.fixedResponse(404, {
          contentType: "text/plain",
          messageBody: "Not Found",
        }),
      }
    );

    /* Create a listener rule for HTTP port 80 to HTTPS  port 443 redirection */
    this.httpListener = this.loadBalancer.addListener(
      `${props.appName}-http-listener`,
      {
        port: 80,
        defaultAction: elbv2.ListenerAction.redirect({
          protocol: "HTTPS",
          port: "443",
        }),
      }
    );
    /* Add Alias A record to the load balancer */
    new route53.ARecord(this, `${props.appName}-alias-record-${region}`, {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.LoadBalancerTarget(this.loadBalancer)
      ),
      recordName: `${region}.${props.apiSubdomainName}.${props.tagEnv}.${props.domainName}`,
    });

    /* Add load balancer arn to SSM parameter store */
    new StringParameter(this, `${props.appName}-${region}-load-balancer-arn`, {
      parameterName: `/${props.appName}/${props.tagEnv}/shared/load-balancer-arn`,
      stringValue: this.loadBalancer.loadBalancerArn,
    });

    const endpoints: ga_endpoints.ApplicationLoadBalancerEndpoint[] = [];

    const lbArn = this.loadBalancer.loadBalancerArn;
    const lbSecurityGroupId =
      this.loadBalancer.connections.securityGroups[0].securityGroupId;

    if (lbArn && lbSecurityGroupId) {
      const endpoint = new ga_endpoints.ApplicationLoadBalancerEndpoint(
        elbv2.ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(
          this,
          `${props.appName}-load-balancer-lookup-${region}`,
          {
            loadBalancerArn: lbArn,
            securityGroupId: lbSecurityGroupId as string,
          }
        ),
        {
          weight: 128,
          preserveClientIp: true,
        }
      );
      endpoints.push(endpoint);

      /* https endpoint group (via port 443)*/
      httpsListener.addEndpointGroup(
        `${props.appName}-${region}-https-endpoint-group`,
        {
          endpoints: [endpoint],
          healthCheckPath: "/health-check",
          endpointGroupName: `${props.appName}-${region}-https-endpoint-group`,
        }
      );

      /* http endpoint group  (via port 80)*/
      httpListener.addEndpointGroup(
        `${props.appName}-${region}-http-endpoint-group`,
        {
          endpoints: [endpoint],
          healthCheckPath: "/health-check",
          endpointGroupName: `${props.appName}-${region}-http-endpoint-group`,
        }
      );
    }

  }
}
