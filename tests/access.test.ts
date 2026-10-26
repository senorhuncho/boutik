import { test } from "node:test";
import assert from "node:assert/strict";
import { LAB_COOKIE, labToken, passcodeMatches, requestHasLabAccess, tokenGrantsAccess } from "../lib/lab/access.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("lab is locked in production when no passcode is configured", () => {
  withEnv({ LAB_PASSCODE: undefined, NODE_ENV: "production" }, () => {
    assert.equal(labToken(), null);
    assert.equal(tokenGrantsAccess(undefined), false);
    assert.equal(tokenGrantsAccess("anything"), false);
    assert.equal(passcodeMatches("anything"), false);
  });
});

test("lab is open in local development without a passcode", () => {
  withEnv({ LAB_PASSCODE: undefined, NODE_ENV: "development" }, () => {
    assert.equal(tokenGrantsAccess(undefined), true);
  });
});

test("only the hashed passcode cookie opens the lab", () => {
  withEnv({ LAB_PASSCODE: "stall-1234-test", NODE_ENV: "production" }, () => {
    const token = labToken();
    assert.ok(token && token.length === 64);
    assert.notEqual(token, "stall-1234-test", "cookie never holds the passcode itself");
    assert.equal(tokenGrantsAccess(token ?? ""), true);
    assert.equal(tokenGrantsAccess("stall-1234-test"), false);
    assert.equal(tokenGrantsAccess(undefined), false);
    assert.equal(passcodeMatches(" stall-1234-test "), true);
    assert.equal(passcodeMatches("stall-1234-tes"), false);
    assert.equal(passcodeMatches(1234), false);

    const ok = new Request("https://x.test/api", { headers: { cookie: `a=1; ${LAB_COOKIE}=${token}; b=2` } });
    const bad = new Request("https://x.test/api", { headers: { cookie: `${LAB_COOKIE}=nope` } });
    const none = new Request("https://x.test/api");
    assert.equal(requestHasLabAccess(ok), true);
    assert.equal(requestHasLabAccess(bad), false);
    assert.equal(requestHasLabAccess(none), false);
  });
});
