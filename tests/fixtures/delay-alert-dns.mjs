import dns from "node:dns/promises";

const lookup = dns.lookup.bind(dns);
const delayMs = Number(process.env.HOMEOPS_TEST_ALERT_DNS_DELAY_MS || "400");

dns.lookup = (hostname, options) => {
  if (hostname !== "alerts.invalid") return lookup(hostname, options);
  return new Promise((_, reject) => {
    setTimeout(() => {
      const error = new Error("getaddrinfo ENOTFOUND alerts.invalid");
      error.code = "ENOTFOUND";
      reject(error);
    }, delayMs);
  });
};
