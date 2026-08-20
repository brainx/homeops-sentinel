import dns from "node:dns/promises";

const lookup = dns.lookup.bind(dns);

dns.lookup = (hostname, options) => {
  if (hostname === "alerts.invalid") return new Promise(() => {});
  return lookup(hostname, options);
};
