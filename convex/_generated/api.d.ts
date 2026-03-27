/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin_actions from "../admin/actions.js";
import type * as admin_internal from "../admin/internal.js";
import type * as admin_queries from "../admin/queries.js";
import type * as ai_actions from "../ai/actions.js";
import type * as analytics_internal from "../analytics/internal.js";
import type * as analytics_queries from "../analytics/queries.js";
import type * as auth_actions from "../auth/actions.js";
import type * as auth_mutations from "../auth/mutations.js";
import type * as auth_queries from "../auth/queries.js";
import type * as conversations_internal from "../conversations/internal.js";
import type * as conversations_mutations from "../conversations/mutations.js";
import type * as conversations_queries from "../conversations/queries.js";
import type * as examResults_internal from "../examResults/internal.js";
import type * as examResults_mutations from "../examResults/mutations.js";
import type * as examResults_queries from "../examResults/queries.js";
import type * as notes_actions from "../notes/actions.js";
import type * as notes_internal from "../notes/internal.js";
import type * as notes_mutations from "../notes/mutations.js";
import type * as notes_queries from "../notes/queries.js";
import type * as payments_actions from "../payments/actions.js";
import type * as payments_internal from "../payments/internal.js";
import type * as payments_mpesaCallback from "../payments/mpesaCallback.js";
import type * as payments_queries from "../payments/queries.js";
import type * as questions_mutations from "../questions/mutations.js";
import type * as questions_queries from "../questions/queries.js";
import type * as security_internal from "../security/internal.js";
import type * as security_mutations from "../security/mutations.js";
import type * as security_queries from "../security/queries.js";
import type * as shared_security from "../shared/security.js";
import type * as shared_validation from "../shared/validation.js";
import type * as subscriptions_internal from "../subscriptions/internal.js";
import type * as subscriptions_mutations from "../subscriptions/mutations.js";
import type * as subscriptions_queries from "../subscriptions/queries.js";
import type * as system_actions from "../system/actions.js";
import type * as system_internal from "../system/internal.js";
import type * as system_mutations from "../system/mutations.js";
import type * as system_queries from "../system/queries.js";
import type * as users_actions from "../users/actions.js";
import type * as users_internal from "../users/internal.js";
import type * as users_mutations from "../users/mutations.js";
import type * as users_queries from "../users/queries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "admin/actions": typeof admin_actions;
  "admin/internal": typeof admin_internal;
  "admin/queries": typeof admin_queries;
  "ai/actions": typeof ai_actions;
  "analytics/internal": typeof analytics_internal;
  "analytics/queries": typeof analytics_queries;
  "auth/actions": typeof auth_actions;
  "auth/mutations": typeof auth_mutations;
  "auth/queries": typeof auth_queries;
  "conversations/internal": typeof conversations_internal;
  "conversations/mutations": typeof conversations_mutations;
  "conversations/queries": typeof conversations_queries;
  "examResults/internal": typeof examResults_internal;
  "examResults/mutations": typeof examResults_mutations;
  "examResults/queries": typeof examResults_queries;
  "notes/actions": typeof notes_actions;
  "notes/internal": typeof notes_internal;
  "notes/mutations": typeof notes_mutations;
  "notes/queries": typeof notes_queries;
  "payments/actions": typeof payments_actions;
  "payments/internal": typeof payments_internal;
  "payments/mpesaCallback": typeof payments_mpesaCallback;
  "payments/queries": typeof payments_queries;
  "questions/mutations": typeof questions_mutations;
  "questions/queries": typeof questions_queries;
  "security/internal": typeof security_internal;
  "security/mutations": typeof security_mutations;
  "security/queries": typeof security_queries;
  "shared/security": typeof shared_security;
  "shared/validation": typeof shared_validation;
  "subscriptions/internal": typeof subscriptions_internal;
  "subscriptions/mutations": typeof subscriptions_mutations;
  "subscriptions/queries": typeof subscriptions_queries;
  "system/actions": typeof system_actions;
  "system/internal": typeof system_internal;
  "system/mutations": typeof system_mutations;
  "system/queries": typeof system_queries;
  "users/actions": typeof users_actions;
  "users/internal": typeof users_internal;
  "users/mutations": typeof users_mutations;
  "users/queries": typeof users_queries;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
