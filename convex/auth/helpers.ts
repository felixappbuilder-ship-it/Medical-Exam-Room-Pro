// convex/auth/helpers.ts
"use node";

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const SALT_ROUNDS = 10;

export const hashPassword = async ({ password }: { password: string }): Promise<string> => {
  return await bcrypt.hash(password, SALT_ROUNDS);
};

export const comparePassword = async ({
  password,
  hash,
}: {
  password: string;
  hash: string;
}): Promise<boolean> => {
  return await bcrypt.compare(password, hash);
};

export const hashSecurityAnswer = async ({ answer }: { answer: string }): Promise<string> => {
  return await bcrypt.hash(answer.toLowerCase().trim(), SALT_ROUNDS);
};

export const compareSecurityAnswer = async ({
  answer,
  hash,
}: {
  answer: string;
  hash: string;
}): Promise<boolean> => {
  return await bcrypt.compare(answer.toLowerCase().trim(), hash);
};

export const signJWT = async ({
  payload,
  expiresIn = "30d",
}: {
  payload: Record<string, any>;
  expiresIn?: string;
}): Promise<string> => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return jwt.sign(payload, secret, { expiresIn });
};

export const verifyJWT = async ({ token }: { token: string }): Promise<any> => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return jwt.verify(token, secret);
};