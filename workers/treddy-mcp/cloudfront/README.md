# treddy.lyncil.com on CloudFront

The Treddy MCP connector's public address is `https://treddy.lyncil.com/mcp`. lyncil.com's DNS is
on Route 53 and Cloudflare can serve a Worker on a custom hostname only for zones it hosts, so a
CloudFront distribution sits in front of the Worker's `treddy-mcp.faulingo-app.workers.dev`:

| Piece | What it does |
|---|---|
| `treddy-viewer-ip.js` | CloudFront Function (viewer request): adds the viewer's IP as `x-treddy-viewer-ip`, overwriting anything the viewer sent |
| `distribution.py` | Writes the distribution config: Worker origin, caching off, all viewer headers except Host, the function above, the `x-treddy-relay-secret` origin header, no custom error pages |
| Route 53 | `A` and `AAAA` alias records for `treddy.lyncil.com` |
| Certificate | the existing `*.lyncil.com` certificate in us-east-1 |

**The relay secret** proves a request passed CloudFront and the Worker, so the per-IP limits on
`/register` can believe the IP that came with it. The same value goes in three places: the
CloudFront origin header, the Worker secret `RELAY_SECRET`, and the function secret
`TREDDY_RELAY_SECRET`. Without it the Worker uses the address Cloudflare saw (CloudFront's, for
requests through this distribution) and the function uses the last `x-forwarded-for` entry.

## Apply

Run every step in **one terminal**, so `$RELAY_SECRET` from step 1 stays set. The connector keeps
working on its workers.dev address until step 6; between steps 6 and 7 (a minute) assistants may
fail to connect.

1. Make the secret. Store it in the password manager too: you need it again only to rebuild the
   distribution.

   ```bash
   export RELAY_SECRET=$(openssl rand -hex 32)
   ```

2. Give the function the secret and deploy the function (it now reads the caller's IP through
   `clientIP()` and caps unlinked `generate` calls at 500 a day in total). Nothing sends the
   secret yet, so this changes nothing for users.

   ```bash
   cd ~/Developer/supabase-backend && supabase secrets set TREDDY_RELAY_SECRET="$RELAY_SECRET" --project-ref ttjzshiaatqvszckjlhw && supabase functions deploy treddy --project-ref ttjzshiaatqvszckjlhw
   ```

3. Give the Worker the secret. The Worker running now never reads it.

   ```bash
   cd ~/Developer/supabase-backend/workers/treddy-mcp && printf %s "$RELAY_SECRET" | wrangler secret put RELAY_SECRET
   ```

4. Create and publish the CloudFront Function, then write the distribution config.

   ```bash
   cd ~/Developer/supabase-backend/workers/treddy-mcp/cloudfront && aws cloudfront create-function --name treddy-viewer-ip --function-config '{"Comment":"Adds the viewer IP for the Treddy MCP Worker","Runtime":"cloudfront-js-2.0"}' --function-code fileb://treddy-viewer-ip.js --query ETag --output text
   ```

   ```bash
   cd ~/Developer/supabase-backend/workers/treddy-mcp/cloudfront && aws cloudfront publish-function --name treddy-viewer-ip --if-match "$(aws cloudfront describe-function --name treddy-viewer-ip --query ETag --output text)" --query 'FunctionSummary.FunctionMetadata.Stage' --output text && python3 -I distribution.py "$(aws cloudfront describe-function --name treddy-viewer-ip --stage LIVE --query 'FunctionSummary.FunctionMetadata.FunctionARN' --output text)" distribution.json
   ```

5. Create the distribution, point the name at it, and wait (5–15 minutes). This adds a new
   distribution and two DNS records; nothing that exists changes.

   ```bash
   cd ~/Developer/supabase-backend/workers/treddy-mcp/cloudfront && aws cloudfront create-distribution --distribution-config file://distribution.json --query 'Distribution.[Id,DomainName]' --output text && rm distribution.json
   ```

   Put the `DomainName` it printed (`d….cloudfront.net`) in `CF`, and the `Id` in `ID`:

   ```bash
   CF=<DomainName> ID=<Id> && aws route53 change-resource-record-sets --hosted-zone-id Z008708214O5D17MZRIR6 --change-batch "{\"Changes\":[{\"Action\":\"CREATE\",\"ResourceRecordSet\":{\"Name\":\"treddy.lyncil.com\",\"Type\":\"A\",\"AliasTarget\":{\"HostedZoneId\":\"Z2FDTNDATAQYW2\",\"DNSName\":\"$CF\",\"EvaluateTargetHealth\":false}}},{\"Action\":\"CREATE\",\"ResourceRecordSet\":{\"Name\":\"treddy.lyncil.com\",\"Type\":\"AAAA\",\"AliasTarget\":{\"HostedZoneId\":\"Z2FDTNDATAQYW2\",\"DNSName\":\"$CF\",\"EvaluateTargetHealth\":false}}}]}" --query 'ChangeInfo.Status' --output text && aws cloudfront wait distribution-deployed --id "$ID" && echo deployed
   ```

   Check that the new address reaches the Worker. The documents still name workers.dev, which is
   expected until step 6.

   ```bash
   curl -s https://treddy.lyncil.com/.well-known/oauth-protected-resource; echo; curl -s -X POST https://treddy.lyncil.com/mcp -H 'Content-Type: application/json' -d '{}' -D - -o /dev/null | grep -iE '^HTTP|www-authenticate'
   ```

6. Switch the connector to the new address: the Worker (its `PUBLIC_ORIGIN` is in `wrangler.toml`),
   then the function, back to back.

   ```bash
   cd ~/Developer/supabase-backend/workers/treddy-mcp && wrangler deploy && cd ~/Developer/supabase-backend && supabase secrets set TREDDY_MCP_PUBLIC_URL=https://treddy.lyncil.com --project-ref ttjzshiaatqvszckjlhw
   ```

7. Check: both documents name `https://treddy.lyncil.com`, and a tokenless POST gets the 401 that
   points there. Then remove Treddy from Claude and ChatGPT and add it again with
   `https://treddy.lyncil.com/mcp`: connections made on the old address don't carry over.

   ```bash
   curl -s https://treddy.lyncil.com/.well-known/oauth-protected-resource; echo; curl -s https://treddy.lyncil.com/.well-known/oauth-authorization-server; echo; curl -s -X POST https://treddy.lyncil.com/mcp -H 'Content-Type: application/json' -d '{}' -D - -o /dev/null | grep -iE '^HTTP|www-authenticate'
   ```

## Roll back

Point the connector at workers.dev again: remove `PUBLIC_ORIGIN` from `wrangler.toml`, then

```bash
cd ~/Developer/supabase-backend/workers/treddy-mcp && wrangler deploy && cd ~/Developer/supabase-backend && supabase secrets set TREDDY_MCP_PUBLIC_URL=https://treddy-mcp.faulingo-app.workers.dev --project-ref ttjzshiaatqvszckjlhw
```

The distribution and the DNS records can stay; delete them in the console if they are no longer
wanted (disable the distribution first).
