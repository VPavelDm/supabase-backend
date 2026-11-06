// CloudFront Function (cloudfront-js-2.0, viewer request) on the treddy.lyncil.com distribution.
// Tells the Worker who the viewer is: CloudFront connects to Cloudflare from its own addresses, so
// without this every login would look like it came from a handful of CloudFront IPs. Whatever the
// viewer sent under this name is overwritten. The Worker believes it only together with the
// x-treddy-relay-secret origin header, which CloudFront adds after this function runs.
function handler(event) {
    var request = event.request;
    request.headers["x-treddy-viewer-ip"] = { value: event.viewer.ip };
    return request;
}
