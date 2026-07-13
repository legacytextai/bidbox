import test from "node:test";
import assert from "node:assert/strict";
import { authErrorMessage, isUnverifiedEmailError } from "../src/lib/authMessages.ts";

test("unverified login gets actionable inbox and spam guidance", () => {
  const error = new Error("Email not confirmed");
  assert.equal(isUnverifiedEmailError(error), true);
  assert.match(authErrorMessage(error), /Spam or Junk/);
  assert.doesNotMatch(authErrorMessage(error), /Email not confirmed/);
});

test("provider credential errors are not exposed raw", () => {
  assert.equal(authErrorMessage(new Error("Invalid login credentials")), "The email or password is incorrect.");
});
