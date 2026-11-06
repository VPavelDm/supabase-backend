"""Writes the CloudFront distribution config for treddy.lyncil.com, without applying it.

The distribution sends everything to the Treddy MCP Worker on workers.dev: caching off (answers
depend on the Authorization header, so a cached one could reach another user), every viewer header
except Host forwarded (Cloudflare routes by the workers.dev Host), the viewer-IP function on viewer
requests, and the relay secret as an origin header. No custom error pages, so the Worker's own
401/404 JSON reaches clients unchanged.

    RELAY_SECRET=... python3 distribution.py <function ARN> distribution.json

The secret comes from the environment so it never lands in a file in the repo; the JSON this writes
contains it, so keep that file out of git and delete it after use.
"""
import json
import os
import sys
import time

ALIAS = "treddy.lyncil.com"
ORIGIN_ID = "treddy-mcp-worker"
ORIGIN_DOMAIN = "treddy-mcp.faulingo-app.workers.dev"
# The existing *.lyncil.com certificate (us-east-1), shared with the other lyncil.com sites.
CERTIFICATE_ARN = "arn:aws:acm:us-east-1:524247456227:certificate/65eac8ef-150b-4bf4-b01c-23b36bc016f7"
# AWS-managed policies.
CACHING_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
ALL_VIEWER_EXCEPT_HOST_HEADER = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
METHODS = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]


def config(function_arn, secret):
    return {
        "CallerReference": f"treddy-mcp-{int(time.time())}",
        "Aliases": {"Quantity": 1, "Items": [ALIAS]},
        "DefaultRootObject": "",
        "Origins": {
            "Quantity": 1,
            "Items": [
                {
                    "Id": ORIGIN_ID,
                    "DomainName": ORIGIN_DOMAIN,
                    "OriginPath": "",
                    "CustomHeaders": {
                        "Quantity": 1,
                        "Items": [{"HeaderName": "x-treddy-relay-secret", "HeaderValue": secret}],
                    },
                    "CustomOriginConfig": {
                        "HTTPPort": 80,
                        "HTTPSPort": 443,
                        "OriginProtocolPolicy": "https-only",
                        "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]},
                        "OriginReadTimeout": 60,
                        "OriginKeepaliveTimeout": 5,
                    },
                    "ConnectionAttempts": 3,
                    "ConnectionTimeout": 10,
                    "OriginShield": {"Enabled": False},
                    "OriginAccessControlId": "",
                }
            ],
        },
        "DefaultCacheBehavior": {
            "TargetOriginId": ORIGIN_ID,
            "TrustedSigners": {"Enabled": False, "Quantity": 0},
            "TrustedKeyGroups": {"Enabled": False, "Quantity": 0},
            "ViewerProtocolPolicy": "redirect-to-https",
            "AllowedMethods": {
                "Quantity": len(METHODS),
                "Items": METHODS,
                "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]},
            },
            "SmoothStreaming": False,
            "Compress": True,
            "LambdaFunctionAssociations": {"Quantity": 0},
            "FunctionAssociations": {
                "Quantity": 1,
                "Items": [{"FunctionARN": function_arn, "EventType": "viewer-request"}],
            },
            "FieldLevelEncryptionId": "",
            "CachePolicyId": CACHING_DISABLED,
            "OriginRequestPolicyId": ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        "CacheBehaviors": {"Quantity": 0},
        "CustomErrorResponses": {"Quantity": 0},
        "Comment": "Treddy MCP connector (treddy.lyncil.com -> Cloudflare Worker)",
        "PriceClass": "PriceClass_100",
        "Enabled": True,
        "ViewerCertificate": {
            "ACMCertificateArn": CERTIFICATE_ARN,
            "SSLSupportMethod": "sni-only",
            "MinimumProtocolVersion": "TLSv1.2_2021",
        },
        "Restrictions": {"GeoRestriction": {"RestrictionType": "none", "Quantity": 0}},
        "HttpVersion": "http2and3",
        "IsIPV6Enabled": True,
    }


def main(function_arn, out_path):
    secret = os.environ.get("RELAY_SECRET", "")
    if len(secret) < 32:
        sys.exit("Set RELAY_SECRET (at least 32 characters) in the environment first.")
    with open(out_path, "w") as out:
        json.dump(config(function_arn, secret), out, indent=2)
    print(f"Wrote {out_path} for {ALIAS} -> {ORIGIN_DOMAIN}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
