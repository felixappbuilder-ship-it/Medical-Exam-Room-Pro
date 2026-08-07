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
import type * as admin_mutations from "../admin/mutations.js";
import type * as admin_queries from "../admin/queries.js";
import type * as ai_actions from "../ai/actions.js";
import type * as ai_internal from "../ai/internal.js";
import type * as ai_registry from "../ai/registry.js";
import type * as ai_router from "../ai/router.js";
import type * as analytics_internal from "../analytics/internal.js";
import type * as analytics_queries from "../analytics/queries.js";
import type * as auth_actions from "../auth/actions.js";
import type * as auth_helpers from "../auth/helpers.js";
import type * as auth_internal from "../auth/internal.js";
import type * as auth_queries from "../auth/queries.js";
import type * as challenges_actions from "../challenges/actions.js";
import type * as challenges_internal from "../challenges/internal.js";
import type * as challenges_mutations from "../challenges/mutations.js";
import type * as conversations_actions from "../conversations/actions.js";
import type * as conversations_internal from "../conversations/internal.js";
import type * as conversations_queries from "../conversations/queries.js";
import type * as crons from "../crons.js";
import type * as examResults_actions from "../examResults/actions.js";
import type * as examResults_internal from "../examResults/internal.js";
import type * as examResults_mutations from "../examResults/mutations.js";
import type * as examResults_queries from "../examResults/queries.js";
import type * as http from "../http.js";
import type * as migrations_001_initial_schema from "../migrations/001_initial_schema.js";
import type * as migrations_backfillReferralFields from "../migrations/backfillReferralFields.js";
import type * as migrations_createAdminAccount from "../migrations/createAdminAccount.js";
import type * as migrations_populateUsernameDisplayName from "../migrations/populateUsernameDisplayName.js";
import type * as notes_actions from "../notes/actions.js";
import type * as notes_internal from "../notes/internal.js";
import type * as notes_queries from "../notes/queries.js";
import type * as notifications_internal from "../notifications/internal.js";
import type * as notifications_mutations from "../notifications/mutations.js";
import type * as notifications_queries from "../notifications/queries.js";
import type * as payments_actions from "../payments/actions.js";
import type * as payments_b2c from "../payments/b2c.js";
import type * as payments_balance from "../payments/balance.js";
import type * as payments_internal from "../payments/internal.js";
import type * as payments_ledger from "../payments/ledger.js";
import type * as payments_queries from "../payments/queries.js";
import type * as payments_reversal from "../payments/reversal.js";
import type * as payments_status from "../payments/status.js";
import type * as publicAssets_actions from "../publicAssets/actions.js";
import type * as publicAssets_internal from "../publicAssets/internal.js";
import type * as publicAssets_mutations from "../publicAssets/mutations.js";
import type * as publicAssets_queries from "../publicAssets/queries.js";
import type * as questions_internal from "../questions/internal.js";
import type * as questions_mutations from "../questions/mutations.js";
import type * as questions_queries from "../questions/queries.js";
import type * as referrals_mutations from "../referrals/mutations.js";
import type * as referrals_queries from "../referrals/queries.js";
import type * as resources_actions from "../resources/actions.js";
import type * as resources_internal from "../resources/internal.js";
import type * as resources_mutations from "../resources/mutations.js";
import type * as resources_queries from "../resources/queries.js";
import type * as security_internal from "../security/internal.js";
import type * as security_mutations from "../security/mutations.js";
import type * as security_queries from "../security/queries.js";
import type * as shared_security from "../shared/security.js";
import type * as shared_validation from "../shared/validation.js";
import type * as sharedExams_actions from "../sharedExams/actions.js";
import type * as sharedExams_internal from "../sharedExams/internal.js";
import type * as sharedExams_mutations from "../sharedExams/mutations.js";
import type * as sharedExams_queries from "../sharedExams/queries.js";
import type * as subscriptions_actions from "../subscriptions/actions.js";
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
  "admin/mutations": typeof admin_mutations;
  "admin/queries": typeof admin_queries;
  "ai/actions": typeof ai_actions;
  "ai/internal": typeof ai_internal;
  "ai/registry": typeof ai_registry;
  "ai/router": typeof ai_router;
  "analytics/internal": typeof analytics_internal;
  "analytics/queries": typeof analytics_queries;
  "auth/actions": typeof auth_actions;
  "auth/helpers": typeof auth_helpers;
  "auth/internal": typeof auth_internal;
  "auth/queries": typeof auth_queries;
  "challenges/actions": typeof challenges_actions;
  "challenges/internal": typeof challenges_internal;
  "challenges/mutations": typeof challenges_mutations;
  "conversations/actions": typeof conversations_actions;
  "conversations/internal": typeof conversations_internal;
  "conversations/queries": typeof conversations_queries;
  crons: typeof crons;
  "examResults/actions": typeof examResults_actions;
  "examResults/internal": typeof examResults_internal;
  "examResults/mutations": typeof examResults_mutations;
  "examResults/queries": typeof examResults_queries;
  http: typeof http;
  "migrations/001_initial_schema": typeof migrations_001_initial_schema;
  "migrations/backfillReferralFields": typeof migrations_backfillReferralFields;
  "migrations/createAdminAccount": typeof migrations_createAdminAccount;
  "migrations/populateUsernameDisplayName": typeof migrations_populateUsernameDisplayName;
  "notes/actions": typeof notes_actions;
  "notes/internal": typeof notes_internal;
  "notes/queries": typeof notes_queries;
  "notifications/internal": typeof notifications_internal;
  "notifications/mutations": typeof notifications_mutations;
  "notifications/queries": typeof notifications_queries;
  "payments/actions": typeof payments_actions;
  "payments/b2c": typeof payments_b2c;
  "payments/balance": typeof payments_balance;
  "payments/internal": typeof payments_internal;
  "payments/ledger": typeof payments_ledger;
  "payments/queries": typeof payments_queries;
  "payments/reversal": typeof payments_reversal;
  "payments/status": typeof payments_status;
  "publicAssets/actions": typeof publicAssets_actions;
  "publicAssets/internal": typeof publicAssets_internal;
  "publicAssets/mutations": typeof publicAssets_mutations;
  "publicAssets/queries": typeof publicAssets_queries;
  "questions/internal": typeof questions_internal;
  "questions/mutations": typeof questions_mutations;
  "questions/queries": typeof questions_queries;
  "referrals/mutations": typeof referrals_mutations;
  "referrals/queries": typeof referrals_queries;
  "resources/actions": typeof resources_actions;
  "resources/internal": typeof resources_internal;
  "resources/mutations": typeof resources_mutations;
  "resources/queries": typeof resources_queries;
  "security/internal": typeof security_internal;
  "security/mutations": typeof security_mutations;
  "security/queries": typeof security_queries;
  "shared/security": typeof shared_security;
  "shared/validation": typeof shared_validation;
  "sharedExams/actions": typeof sharedExams_actions;
  "sharedExams/internal": typeof sharedExams_internal;
  "sharedExams/mutations": typeof sharedExams_mutations;
  "sharedExams/queries": typeof sharedExams_queries;
  "subscriptions/actions": typeof subscriptions_actions;
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
