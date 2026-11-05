import { z } from "zod";
import { text } from "./domain.js";
export const memberSchema = z.object({
  name: text,
  document: z
    .string()
    .trim()
    .regex(/^\d{6,12}$/, "Documento de 6 a 12 dígitos"),
  email: z.union([z.email(), z.literal("")]).default(""),
  phone: z.string().trim().max(40).default(""),
  notes: z.string().trim().max(2000).default(""),
  address: z.string().trim().max(300).default(""),
  emergency_name: z.string().trim().max(180).default(""),
  emergency_phone: z.string().trim().max(40).default(""),
  plan_ids: z.array(text).max(20).default([]),
});
