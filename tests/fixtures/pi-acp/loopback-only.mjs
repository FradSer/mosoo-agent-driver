// Loaded only into pinned contract children. Fail closed before non-loopback TCP.
import net from "node:net";
import fs from "node:fs";
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = net._normalizeArgs(args);
  const options = normalized[0];
  if (!options.path) {
    const host = options.host || "localhost";
    if (!["127.0.0.1", "::1", "localhost"].includes(host)) {
      fs.appendFileSync(process.env.PI_CONTRACT_NETWORK_LOG, `${host}\n`);
      throw new Error(`Pinned contract blocked non-loopback connection: ${host}`);
    }
  }
  return original.apply(this, args);
};
