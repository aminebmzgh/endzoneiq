import { describe, expect, it } from "vitest";
import {
  canManageBilling,
  canViewFullBreakdown,
  canViewProContent,
  isAdmin,
  ownsResource,
  type Viewer,
} from "./authz";

const free: Viewer = { userId: "u1", email: "a@x.com", role: "user", plan: "free" };
const pro: Viewer = { userId: "u2", email: "b@x.com", role: "user", plan: "pro" };
const admin: Viewer = { userId: "u3", email: "c@x.com", role: "admin", plan: "free" };
const anon: Viewer = null;

describe("authorization rules", () => {
  it("Pro content is for Pro users (and admins) only", () => {
    expect(canViewProContent(anon)).toBe(false);
    expect(canViewProContent(free)).toBe(false);
    expect(canViewProContent(pro)).toBe(true);
    expect(canViewProContent(admin)).toBe(true);
  });

  it("full breakdowns: free games for everyone, the rest for Pro", () => {
    for (const v of [anon, free, pro]) {
      expect(canViewFullBreakdown(v, { freeBreakdown: true })).toBe(true);
    }
    expect(canViewFullBreakdown(anon, { freeBreakdown: false })).toBe(false);
    expect(canViewFullBreakdown(free, { freeBreakdown: false })).toBe(false);
    expect(canViewFullBreakdown(pro, { freeBreakdown: false })).toBe(true);
  });

  it("only admins are admins", () => {
    expect(isAdmin(anon)).toBe(false);
    expect(isAdmin(free)).toBe(false);
    expect(isAdmin(pro)).toBe(false);
    expect(isAdmin(admin)).toBe(true);
  });

  it("users own only their own resources, admins included", () => {
    expect(ownsResource(free, "u1")).toBe(true);
    expect(ownsResource(free, "u2")).toBe(false);
    expect(ownsResource(admin, "u1")).toBe(false);
    expect(ownsResource(anon, "u1")).toBe(false);
  });

  it("billing needs an account", () => {
    expect(canManageBilling(anon)).toBe(false);
    expect(canManageBilling(free)).toBe(true);
  });
});
